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
    Odd,
    PromotedOdd,
    SurebetV2Odd,
    SurebetV2Promoted,
    VMatch,
} from './db'

/**
 * v3检查进程
 */
async function startV3Check() {
    //读取开赛时间配置
    const final_check_time = await (async () => {
        const final_check_time = await getSetting('final_check_time')
        return typeof final_check_time === 'number' ? final_check_time : 5
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
 * V3的持续盘口判断
 * @param data
 */
async function processV3Check(
    data: CrownRobot.Output<{
        match_id: number
    }>,
) {
    if (!data.data || !data.extra) return

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

    const match_id = data.extra.match_id
    const crown_match_id = data.crown_match_id

    //读取对应的比赛和盘口数据
    const match = await VMatch.findOne({
        where: {
            id: match_id,
        },
    })

    //状态不对的比赛不需要处理
    if (!match || match.status !== '') return

    const odds = await Odd.findAll({
        where: {
            match_id,
            status: 'ready',
        },
    })

    //没有需要处理的盘口也不处理
    if (odds.length === 0) return

    //写入主盘口数据
    const updateOdd = async (oddInfo: Crown.OddInfo, period: Period, type: 'ah' | 'sum') => {
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
        const newOne = await CrownOdd.create(
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
            { returning: true },
        )

        //判断一下如果有变盘，那么之前的数据都不要了，也不需要返回
        if (lastOne && !Decimal(lastOne.condition).eq(oddInfo.condition)) {
            await CrownOdd.update(
                {
                    is_ignored: 1,
                },
                {
                    where: {
                        match_id,
                        variety: oddInfo.variety,
                        period,
                        type,
                        is_ignored: 0,
                        id: {
                            [Op.lt]: newOne.id,
                        },
                    },
                },
            )
            return
        }

        return newOne
    }

    //处理某个盘口的数据
    const processOdd = async (oddInfo: Crown.OddInfo, period: Period, type: 'ah' | 'sum') => {
        //首先进行盘口写入
        const newOne = await updateOdd(oddInfo, period, type)

        //如果盘口写入之后没有返回，那么代表没有可以比较的数据，直接出去了
        if (!newOne) return

        //查看这个类型的盘口是否已经有了推荐，如果有了也不做后续的处理了
        const exists = await PromotedOdd.findOne({
            where: {
                match_id,
                variety: oddInfo.variety,
                period,
                odd_type: type,
            },
            attributes: ['id'],
        })
        if (exists) return

        //读取相同类型的盘口追踪数据
        const rows = await CrownOdd.findAll({
            where: {
                match_id,
                variety: oddInfo.variety,
                period,
                type,
                is_ignored: 0,
                id: {
                    [Op.lte]: newOne.id,
                },
                created_at: {
                    [Op.gte]: new Date(newOne.created_at.valueOf() - v3_check_max_duration * 60000),
                },
            },
            order: [['id', 'asc']],
        })

        //如果记录的总数都不够3条那也不处理了
        if (rows.length < 3) return

        let current = 1
        let lastDirection = '' as unknown as 'value1' | 'value2'
        let stackRows: CrownOdd[] = [rows[0]]
        let result: 'value1' | 'value2' | undefined = undefined
        let resultRow: CrownOdd | undefined = undefined

        while (current < rows.length) {
            const currentRow = rows[current]
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
            const minCheckFirstRow = rows.find(
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
            //水位下降条件未达到，什么都不做，出去了
            return
        }

        //更新盘口记录表中的数据，标记判定成功开始和结束区间
        await CrownOdd.update(
            {
                promote_flag: result === 'value1' ? 1 : 2,
            },
            {
                where: {
                    id: {
                        [Op.between]: [stackRows[0].id, resultRow.id],
                    },
                    match_id,
                    variety: oddInfo.variety,
                    period,
                    type,
                },
            },
        )

        const is_valid = match.tournament_is_open
        if (!is_valid) return

        //创建满足条件的推荐数据
        //计算推荐数据
        const oddType = (() => {
            if (type === 'ah') {
                return result === 'value1' ? 'ah1' : 'ah2'
            } else {
                return result === 'value1' ? 'under' : 'over'
            }
        })()
        //计算盘口
        const condition = (() => {
            switch (oddType) {
                case 'ah1':
                    return resultRow.condition
                case 'ah2':
                    return Decimal(0).sub(resultRow.condition).toString()
                default:
                    return resultRow.condition
            }
        })()

        const week_day = getWeekDay()

        const promoted = await PromotedOdd.create({
            match_id,
            source: 'crown_odd',
            source_id: resultRow.id,
            is_valid,
            variety: oddInfo.variety,
            period,
            type: oddType,
            condition,
            back: 0,
            value: resultRow[result],
            start_odd_data: {
                id: Number(stackRows[0].id),
                field: result,
                value: stackRows[0][result],
                time: stackRows[0].created_at.valueOf(),
            },
            end_odd_data: {
                id: Number(resultRow.id),
                field: result,
                value: resultRow[result],
                time: resultRow.created_at.valueOf(),
            },
            week_day,
            odd_type: getOddIdentification(oddType),
        })

        if (is_valid) {
            const lastRow = await PromotedOdd.findOne({
                where: {
                    week_day,
                    is_valid: 1,
                    id: {
                        [Op.lt]: promoted.id,
                    },
                },
                order: [['id', 'desc']],
                attributes: ['week_id'],
            })
            const week_id = lastRow ? lastRow.week_id + 1 : 1
            promoted.week_id = week_id
            await promoted.save()

            await publish(CONFIG.queues['send_promoted'], JSON.stringify({ id: promoted.id }))

            //调用与v2的surebet数据的融合判断
            //查询是否存在对应的surebet数据
            const surebetOdd = await SurebetV2Odd.findOne({
                where: {
                    crown_match_id,
                    variety: oddInfo.variety,
                    period,
                    type: oddType,
                    condition,
                },
            })

            if (surebetOdd && !surebetOdd.promote_id) {
                await createV2ToV3Promote(surebetOdd, promoted, match.tournament_label_id)
            }
        }
    }

    //读取各个类型的主盘口数据
    const goalAh = data.data.odds.find((t) => t.variety === 'goal' && t.type === 'r')
    const goalSum = data.data.odds.find((t) => t.variety === 'goal' && t.type === 'ou')

    if (goalAh) {
        await processOdd(goalAh, 'regularTime', 'ah')
    }
    if (goalSum) {
        await processOdd(goalSum, 'regularTime', 'sum')
    }
}

/**
 * 拿到皇冠数据之后的v3检查进程
 */
async function startV3CheckProcessor() {
    const [promise] = consume(CONFIG.queues['v3_check'], async (content) => {
        await processV3Check(JSON.parse(content))
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

    //只有新增数据的时候需要判断是否有匹配的盘口
    //首先寻找盘口对应的比赛
    const match = await VMatch.findOne({
        where: {
            crown_match_id: surebet.crown_match_id,
        },
        transaction: null,
        attributes: ['id', 'status', 'tournament_label_id'],
    })

    //如果没有找到比赛，或者比赛状态不对，那么就出去了
    if (!match || match.status !== '') {
        return
    }

    //再根据比赛id，寻找有没有盘口相同的推荐
    const promoted = await PromotedOdd.findOne({
        where: {
            match_id: match.id,
            source: 'crown_odd',
            variety: odd.variety,
            period: odd.period,
            type: odd.type,
            condition: odd.condition,
            is_valid: 1,
        },
    })

    if (!promoted) {
        //没有找到盘口，或者是找到的盘口标记为不推荐，那也出去了
        return
    }

    await createV2ToV3Promote(odd, promoted, match.tournament_label_id)
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
}
