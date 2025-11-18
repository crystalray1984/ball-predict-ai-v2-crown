import Decimal from 'decimal.js'
import { Op, QueryTypes } from 'sequelize'
import { getOddIdentification, getPromotedOddInfo, getWeekDay, runLoop } from './common/helpers'
import { consume, publish } from './common/rabbitmq'
import { getSetting } from './common/settings'
import { CONFIG } from './config'
import {
    CrownOdd,
    db,
    LabelPromoted,
    Match,
    PromotedOdd,
    SurebetV2Odd,
    SurebetV2Promoted,
    VMatch,
} from './db'

/**
 * 处理赛事的最终结算
 */
async function processFinalMatches() {
    //读取开赛时间配置
    const final_check_time = await (async () => {
        const final_check_time = await getSetting('final_check_time')
        return typeof final_check_time === 'number' ? final_check_time : 20
    })()

    //先查询需要处理的比赛
    const matches = await db.query(
        {
            query: `
        SELECT
            id,
            crown_match_id
        FROM
            match
        WHERE
            match_time <= ?
            AND status = ?
            AND id IN (SELECT match_id FROM odd WHERE status = ?)
        `,
            values: [
                new Date(Date.now() + final_check_time * 60000), //只抓取将在指定时间内开赛的比赛
                '', //只选择还未结算的比赛
                'ready', //有准备中的盘口的比赛
            ],
        },
        {
            type: QueryTypes.SELECT,
            mapToModel: true,
            model: VMatch,
        },
    )

    if (matches.length === 0) return

    //把这些比赛都标记为已结算
    await Match.update(
        { status: 'final' },
        {
            where: {
                id: {
                    [Op.in]: matches.map((t) => t.id),
                },
            },
        },
    )

    for (const match of matches) {
        console.log(
            '最终结算判断',
            `match_id=${match.id}`,
            `crown_match_id=${match.crown_match_id}`,
        )

        //查询这几个端的指定盘口数据
        await processFinalCheck(
            match,
            await CrownOdd.findAll({
                where: {
                    period: 'regularTime',
                    variety: 'goal',
                    type: 'ah',
                },
                order: ['id'],
            }),
        )
        await processFinalCheck(
            match,
            await CrownOdd.findAll({
                where: {
                    period: 'regularTime',
                    variety: 'goal',
                    type: 'sum',
                },
                order: ['id'],
            }),
        )
        // await processFinalCheck(
        //     match,
        //     await CrownOdd.findAll({
        //         where: {
        //             period: 'peroid1',
        //             variety: 'goal',
        //             type: 'ah',
        //         },
        //         order: ['id'],
        //     }),
        // )
        // await processFinalCheck(
        //     match,
        //     await CrownOdd.findAll({
        //         where: {
        //             period: 'peroid1',
        //             variety: 'goal',
        //             type: 'sum',
        //         },
        //         order: ['id'],
        //     }),
        // )
    }
}

/**
 * 进行V3的最终判断
 * @param match 比赛
 */
async function processFinalCheck(match: VMatch, crownOdds: CrownOdd[]) {
    //不足3个直接出去
    if (crownOdds.length < 3) return

    //读取配置
    const {
        v3_check_max_duration,
        v3_check_max_value,
        v3_check_min_duration,
        v3_check_min_value,
        v3_check_min_promote_value,
    } = await getSetting(
        'v3_check_max_duration',
        'v3_check_max_value',
        'v3_check_min_duration',
        'v3_check_min_value',
        'v3_check_min_promote_value',
    )

    //首先根据盘口的变化，把抓取到的皇冠盘口分组
    const groups: CrownOdd[][] = []
    let lastGroup: CrownOdd[] = []
    let lastCondition: string = ''
    crownOdds.forEach((odd) => {
        if (!lastCondition || !Decimal(odd.condition).eq(lastCondition)) {
            lastGroup = [odd]
            groups.push(lastGroup)
        } else {
            lastGroup.push(odd)
        }
    })

    //把组倒过来，从最后产生的盘口组开始计算
    groups.reverse()

    //对每个组内的数据进行判断
    for (const rows of groups) {
        //如果这个组的数据不足3个，那么跳过
        if (rows.length < 3) return

        let current = 1
        let lastDirection = '' as unknown as 'value1' | 'value2'
        let stackRows: CrownOdd[] = [rows[0]]
        let result: 'value1' | 'value2' | undefined = undefined
        let resultRow: CrownOdd | undefined = undefined

        while (current < rows.length) {
            const currentRow = rows[current]

            //stackRows的首行与currentRow的时间间隔不能超过v3_check_max_duration分钟，如果超过了就要从stackRows头部进行排除
            while (stackRows.length > 0) {
                if (
                    currentRow.created_at.valueOf() - stackRows[0].created_at.valueOf() <=
                    v3_check_max_duration * 6000
                ) {
                    break
                }
                stackRows.shift()
            }
            if (stackRows.length === 0) {
                //堆栈池里没数据了，把当前行重新作为堆栈池的首个数据，从后面的行开始计算
                stackRows = [currentRow]
                current++
                continue
            }

            let fromRow = stackRows[0]
            let lastRow = stackRows[stackRows.length - 1]

            //与上一条记录对比，判断是上盘降水还是下盘降水
            const direction = Decimal(currentRow.value1).lt(lastRow.value1) ? 'value1' : 'value2'

            if (lastDirection !== direction) {
                //之前有判断出方向，但是这次的方向与之前的不同，那就表示水位发生了波动
                //那么把最近的2次记录作为堆栈数据继续进行后续判断
                stackRows = [lastRow]
                fromRow = lastRow
                lastDirection = direction
            }

            //先进行异常波动的判断，寻找满足异常时间段内的最早的记录
            const minCheckFirstRow = stackRows.find(
                (t) =>
                    t.created_at.valueOf() >=
                    currentRow.created_at.valueOf() - v3_check_min_duration * 60000,
            )
            //如果异常时间段内有记录，且水位下降超过限定值
            if (
                minCheckFirstRow &&
                Decimal(minCheckFirstRow[direction])
                    .sub(currentRow[direction])
                    .gte(v3_check_min_value)
            ) {
                //把当前行作为最新的堆栈数据，跳过后续判断
                stackRows = [currentRow]
                current++
                continue
            }

            //然后进行最大时段判断，因为查询出来的数据都是已经满足最大时段的数据，所以只需要判断水位下降得够不够就行了
            if (
                !Decimal(fromRow[direction]).sub(currentRow[direction]).gte(v3_check_max_value) ||
                Decimal(currentRow[direction]).lt(v3_check_min_promote_value)
            ) {
                //水位下降不足，或者水位低于最低推荐水位，把当前行压入堆栈，继续进行循环判断
                stackRows.push(currentRow)
                current++
                continue
            }

            //到这里就是水位下降够了，那么记录推荐信息，后面也不用循环了，直接出去了
            result = direction
            resultRow = currentRow
            break
        }

        if (!result || !resultRow) {
            //水位下降条件未达到，什么都不做，继续判断下一个组
            continue
        }

        //各种判断都满足了
        //先把最终计算获得的surebet盘口，标记为已使用
        await CrownOdd.update(
            {
                promote_flag: result === 'value1' ? 1 : 2,
            },
            {
                where: {
                    id: {
                        [Op.in]: stackRows.map((t) => t.id),
                    },
                },
            },
        )

        //先判断是不是有相同类型的推荐已经产生
        const promotedExists = await PromotedOdd.findOne({
            where: {
                match_id: match.id,
                variety: resultRow.variety,
                period: resultRow.period,
                odd_type: resultRow.type,
            },
            attributes: ['id'],
        })
        if (promotedExists) break

        //开始创建推荐
        if (!match.tournament_is_open) return

        const type = (() => {
            if (resultRow.type === 'ah') {
                return result === 'value1' ? 'ah1' : 'ah2'
            } else {
                return result === 'value1' ? 'under' : 'over'
            }
        })()
        const condition = (() => {
            switch (type) {
                case 'ah1':
                    return resultRow.condition
                case 'ah2':
                    return Decimal(0).sub(resultRow.condition).toString()
                default:
                    return resultRow.condition
            }
        })()
        const week_day = getWeekDay()

        //总台推荐
        const promoted = await PromotedOdd.create({
            match_id: match.id,
            source: 'crown_odd',
            source_id: resultRow.id,
            variety: resultRow.variety,
            period: resultRow.period,
            odd_type: resultRow.type,
            is_valid: 1,
            type,
            condition,
            back: 0,
            value: resultRow[result],
            week_day,
            start_odd_data: {
                id: stackRows[0].id,
                time: stackRows[0].created_at.valueOf(),
                value: stackRows[0][result],
                field: result,
            },
            end_odd_data: {
                id: resultRow.id,
                time: resultRow.created_at.valueOf(),
                value: resultRow[result],
                field: result,
            },
        })
        //设置总台的周标记
        const weekLast = await PromotedOdd.findOne({
            where: {
                week_day,
                is_valid: 1,
                id: {
                    [Op.lt]: promoted.id,
                },
            },
            order: [['id', 'desc']],
            attributes: ['id', 'week_id'],
        })
        promoted.week_id = weekLast ? weekLast.week_id + 1 : 1
        await promoted.save()
        await publish(CONFIG.queues['send_promoted'], JSON.stringify({ id: promoted.id }))

        //新老融合推荐
        //查询是否存在对应的surebet数据
        const surebetOdd = await SurebetV2Odd.findOne({
            where: {
                crown_match_id: match.crown_match_id,
                variety: promoted.variety,
                period: promoted.period,
                type: promoted.type,
                condition,
            },
        })

        if (surebetOdd && !surebetOdd.promote_id) {
            await createV2ToV3Promote(surebetOdd, promoted, match.tournament_label_id)
        }

        //这个组已经判断完了，不需要判断后续的组了，直接出去了
        return
    }
}

/**
 * v3检查进程
 */
async function startV3Check() {
    //读取开赛时间配置
    const final_check_time = await (async () => {
        const final_check_time = await getSetting('final_check_time')
        return typeof final_check_time === 'number' ? final_check_time : 20
    })()

    //先查询需要处理的比赛
    const matches = await db.query<{
        id: number
        crown_match_id: string
    }>(
        {
            query: `
        SELECT
            match.id,
            match.crown_match_id
        FROM
            match
        INNER JOIN
            tournament ON tournament.id = match.tournament_id
        WHERE
            match.match_time > ?
            AND match.status = ?
            AND match.id IN (SELECT match_id FROM odd WHERE status = ?)
            AND tournament.is_open = ?
        `,
            values: [
                new Date(Date.now() + final_check_time * 60000), //只抓取5分内开赛的比赛
                '', //只选择还未结算的比赛
                'ready', //有准备中的盘口的比赛
                1, //只抓取开启中的联赛
            ],
        },
        {
            type: QueryTypes.SELECT,
        },
    )

    console.log('需要采集盘口的比赛', matches.length)

    if (matches.length === 0) return

    //把数据抛入队列
    await publish(
        'crown_odd',
        matches.map((match) => {
            return JSON.stringify({
                next: CONFIG.queues['v3_check'],
                crown_match_id: match.crown_match_id,
                extra: {
                    match_id: match.id,
                },
            })
        }),
    )
}

/**
 * 保存从皇冠持续采集来的盘口
 */
async function saveCrownOdd({
    crown_match_id,
    data,
    extra,
}: CrownRobot.Output<{
    match_id: number
}>) {
    if (!data || !extra) return

    const { match_id } = extra

    //检查比赛的状态
    const match = await Match.findOne({
        where: {
            id: extra.match_id,
        },
        attributes: ['status'],
    })

    //没有找到比赛或者比赛状态不对就出去了
    if (!match || match.status !== '') return

    /**
     * 保存盘口
     */
    const saveOdd = async (oddInfo: Crown.OddInfo, period: Period, type: OddIdentification) => {
        const lastOne = await CrownOdd.findOne({
            where: {
                match_id,
                variety: oddInfo.variety,
                period,
                type,
            },
            order: [['id', 'desc']],
        })

        //如果有数据，且这个数据的盘口水位完全相等，那么什么都不做，直接返回
        if (lastOne) {
            if (
                Decimal(oddInfo.condition).eq(lastOne.condition) &&
                Decimal(oddInfo.value_h).eq(lastOne.value1) &&
                Decimal(oddInfo.value_c).eq(lastOne.value2)
            ) {
                return
            }
        }

        //插入新数据
        await CrownOdd.create(
            {
                match_id,
                crown_match_id,
                variety: oddInfo.variety,
                period,
                type,
                condition: oddInfo.condition,
                value1: oddInfo.value_h,
                value2: oddInfo.value_c,
            },
            { returning: false },
        )
    }

    //读取各个类型的主盘口数据
    const ah = data.odds.find((t) => t.variety === 'goal' && t.type === 'r')
    const sum = data.odds.find((t) => t.variety === 'goal' && t.type === 'ou')
    const ahPeriod1 = data.odds.find((t) => t.variety === 'goal' && t.type === 'hr')
    const sumPeriod1 = data.odds.find((t) => t.variety === 'goal' && t.type === 'hou')

    if (ah) {
        await saveOdd(ah, 'regularTime', 'ah')
    }
    if (sum) {
        await saveOdd(sum, 'regularTime', 'sum')
    }
    if (ahPeriod1) {
        await saveOdd(ahPeriod1, 'period1', 'ah')
    }
    if (sumPeriod1) {
        await saveOdd(sumPeriod1, 'period1', 'sum')
    }
}

/**
 * 拿到皇冠数据之后的v3检查进程
 */
async function startV3CheckProcessor() {
    const [promise] = consume(CONFIG.queues['v3_check'], async (content) => {
        await saveCrownOdd(JSON.parse(content))
    })
    await promise
}

/**
 * 拿到v2系统抛过来的surebet数据之后的检查进程
 */
async function startSurebetV2ToV3Check() {
    const [promise] = consume(CONFIG.queues['surebet_v2_to_v3'], async (content) => {
        await processSurebetV2ToV3Check(JSON.parse(content))
    })
    await promise
}

/**
 * 处理v2系统抛过来的surebet数据
 * @param surebet
 */
async function processSurebetV2ToV3Check(surebet: Surebet.Output) {
    //需要对surebet数据做一次反推
    const oddInfo = getPromotedOddInfo(surebet.type, 1)

    const [odd, created] = await SurebetV2Odd.findOrCreate({
        where: {
            crown_match_id: surebet.crown_match_id,
            variety: surebet.type.variety,
            period: surebet.type.period,
            type: oddInfo.type,
            condition: oddInfo.condition,
        },
        defaults: {
            crown_match_id: surebet.crown_match_id,
            variety: surebet.type.variety,
            period: surebet.type.period,
            type: oddInfo.type,
            condition: oddInfo.condition,
            value: surebet.surebet_value,
        },
    })

    if (!created) {
        //如果不是新增的数据，仅仅更新一下水位就可以出去了
        odd.value = surebet.surebet_value
        await odd.save()
        return
    }
}

/**
 * 创建V2和V3的surebet融合推荐
 */
async function createV2ToV3Promote(
    odd: SurebetV2Odd,
    promoted: PromotedOdd,
    tournament_label_id: number,
) {
    //判断surebet盘口的初始条件
    if (odd.promote_id > 0) return

    //判断v3推荐的初始条件
    if (!promoted.is_valid || !promoted.end_odd_data) return

    //读取系统配置
    const { surebet_v2_to_v3_back, surebet_v2_to_v3_min_value } = await getSetting(
        'surebet_v2_to_v3_back',
        'surebet_v2_to_v3_min_value',
    )

    //先创建要推送的盘口数据
    const oddInfo = getPromotedOddInfo(promoted, surebet_v2_to_v3_back)

    //创建标识
    const oddType = getOddIdentification(oddInfo.type)

    //检查是否已经存在了推荐
    const exists = await SurebetV2Promoted.findOne({
        where: {
            match_id: promoted.match_id,
            variety: promoted.variety,
            period: promoted.period,
            odd_type: oddType,
        },
        attributes: ['id'],
    })
    if (exists) return

    //计算水位是否满足要求
    const value = await (async () => {
        if (!surebet_v2_to_v3_back) {
            //不是反推，就直接取原始水位就行
            return promoted.end_odd_data!.value
        }

        //反推就需要读取原始数据
        const field = promoted.end_odd_data!.field === 'value1' ? 'value2' : 'value1'
        const origin_odd = await CrownOdd.findOne({
            where: {
                id: promoted.end_odd_data!.id,
            },
        })
        if (!origin_odd) return '0'
        return origin_odd[field]
    })()

    const is_valid = Decimal(value).gte(surebet_v2_to_v3_min_value) ? 1 : 0

    //插入数据
    const promotedOdd = await SurebetV2Promoted.create({
        match_id: promoted.match_id,
        is_valid,
        week_day: promoted.week_day,
        skip: is_valid ? '' : 'value',
        variety: promoted.variety,
        period: promoted.period,
        type: oddInfo.type,
        condition: oddInfo.condition,
        back: surebet_v2_to_v3_back ? 1 : 0,
        odd_type: oddType,
        value,
    })

    //更新原始表的数据
    await SurebetV2Odd.update(
        { promote_id: promotedOdd.id },
        { where: { id: odd.id }, returning: false },
    )

    if (is_valid) {
        //计算排序
        const lastRow = await SurebetV2Promoted.findOne({
            where: {
                week_day: promoted.week_day,
                is_valid: 1,
                id: {
                    [Op.lt]: promotedOdd.id,
                },
            },
            order: [['id', 'desc']],
            attributes: ['week_id'],
        })
        const week_id = lastRow ? lastRow.week_id + 1 : 1
        promotedOdd.week_id = week_id
        await promotedOdd.save()

        //发出推荐
        await publish(
            CONFIG.queues['send_promoted'],
            JSON.stringify({ id: promotedOdd.id, type: 'surebet_v2_promoted' }),
        )

        //如果这个推荐是有标签的，那么还要按标签做推送
        if (tournament_label_id > 0) {
            //生成推送数据
            const label_promoted = await LabelPromoted.create({
                promote_id: promotedOdd.id,
                label_id: tournament_label_id,
                week_day: promoted.week_day,
            })
            const lastRow = await LabelPromoted.findOne({
                where: {
                    label_id: tournament_label_id,
                    week_day: promoted.week_day,
                    id: {
                        [Op.lt]: label_promoted.id,
                    },
                },
                order: [['id', 'desc']],
                attributes: ['week_id'],
            })
            const week_id = lastRow ? lastRow.week_id + 1 : 1
            label_promoted.week_id = week_id
            await label_promoted.save()

            await publish(
                CONFIG.queues['send_promoted'],
                JSON.stringify({ id: label_promoted.id, type: 'label_promoted' }),
            )
        }
    }
}

if (require.main === module) {
    runLoop(60000, startV3Check)
    startV3CheckProcessor()
    startSurebetV2ToV3Check()
    runLoop(30000, processFinalMatches)
}
