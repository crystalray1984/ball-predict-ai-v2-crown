import Decimal from 'decimal.js'
import { Op, QueryTypes } from 'sequelize'
import { runLoop } from './common/helpers'
import { consume, publish } from './common/rabbitmq'
import { getSetting } from './common/settings'
import { CONFIG } from './config'
import { CrownOdd, db, Match, Odd, PromotedOddChannel2, VMatch } from './db'
import dayjs from 'dayjs'

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
            id,
            crown_match_id
        FROM
            match
        WHERE
            match_time > ?
            AND status = ?
            AND id IN (SELECT match_id FROM odd WHERE status = ?)
        `,
            values: [
                new Date(Date.now() + final_check_time * 60000), //只抓取5分内开赛的比赛
                '', //只选择还未结算的比赛
                'ready', //有准备中的盘口的比赛
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
        const exists = await PromotedOddChannel2.findOne({
            where: {
                match_id,
                is_valid: 1,
                variety: oddInfo.variety,
                period,
                type: {
                    [Op.in]: type === 'ah' ? ['ah1', 'ah2'] : ['over', 'under'],
                },
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

        const is_valid = match.tournament_is_open
        const week_day = parseInt(dayjs().startOf('week').format('YYYYMMDD'))

        const promoted = await PromotedOddChannel2.create({
            match_id,
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
        })

        if (is_valid) {
            const week_id = await PromotedOddChannel2.count({
                where: {
                    week_day,
                    is_valid: 1,
                    id: {
                        [Op.lte]: promoted.id,
                    },
                },
            })
            promoted.week_id = week_id
            await promoted.save()
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

        //发送推送信息
        publish(CONFIG.queues['send_promoted_channel2'], JSON.stringify({ id: promoted.id }))
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

if (require.main === module) {
    runLoop(60000, startV3Check)
    startV3CheckProcessor()
}
