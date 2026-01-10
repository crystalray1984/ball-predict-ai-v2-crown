import Decimal from 'decimal.js'
import { QueryTypes } from 'sequelize'
import { getOddIdentification, getWeekDay, runLoop } from './common/helpers'
import { consume, publish } from './common/rabbitmq'
import { CONFIG } from './config'
import { findMatchedOdd } from './crown'
import { db, Match, Promoted, RockballOdd, RockballOdd2 } from './db'

/**
 * 开启滚球检查
 */
async function startRockballCheck() {
    //读取所有需要检查的滚球盘
    const matches1 = await db.query<{
        id: number
        crown_match_id: string
    }>(
        {
            query: `
        SELECT
            DISTINCT
            "match".id,
            "match".crown_match_id
        FROM
            rockball_odd
        JOIN
            "match" ON "match".id = rockball_odd.match_id
        WHERE
            rockball_odd.status = ?
            AND
            (
                (rockball_odd.period = 'regularTime' AND "match".match_time BETWEEN ? AND ?)
                OR
                (rockball_odd.period = 'peroid1' AND "match".match_time BETWEEN ? AND ?)
            )
        `,
            values: [
                '', //盘口状态
                new Date(Date.now() - 7200000),
                new Date(), //全场盘口的时间范围
                new Date(Date.now() - 3600000),
                new Date(), //半场盘口的时间范围
            ],
        },
        {
            type: QueryTypes.SELECT,
        },
    )

    const matches2 = await db.query<{
        id: number
        crown_match_id: string
    }>(
        {
            query: `
        SELECT
            DISTINCT
            "match".id,
            "match".crown_match_id
        FROM
            rockball_odd2
        JOIN
            "match" ON "match".id = rockball_odd2.match_id
        WHERE
            rockball_odd2.status = ?
            AND
            (
                (rockball_odd2.period = 'regularTime' AND "match".match_time BETWEEN ? AND ?)
                OR
                (rockball_odd2.period = 'peroid1' AND "match".match_time BETWEEN ? AND ?)
            )
        `,
            values: [
                '', //盘口状态
                new Date(Date.now() - 7200000),
                new Date(), //全场盘口的时间范围
                new Date(Date.now() - 3600000),
                new Date(), //半场盘口的时间范围
            ],
        },
        {
            type: QueryTypes.SELECT,
        },
    )

    //合并matches1和matches2的数据
    const list = matches1.map((match) => ({
        crown_match_id: match.crown_match_id,
        next: CONFIG.queues['rockball_check_after'],
        extra: {
            crown_match_id: match.crown_match_id,
            source: [{ channel: 'rockball', id: match.id }],
        },
        show_type: 'live',
    }))
    matches2.forEach((match) => {
        const exists = list.find((t) => t.crown_match_id === match.crown_match_id)
        if (!exists) {
            list.push({
                crown_match_id: match.crown_match_id,
                next: CONFIG.queues['rockball_check_after'],
                extra: {
                    crown_match_id: match.crown_match_id,
                    source: [{ channel: 'rockball2', id: match.id }],
                },
                show_type: 'live',
            })
        } else {
            exists.extra.source.push({ channel: 'rockball2', id: match.id })
        }
    })

    console.log('需要抓取滚球盘的比赛', list.length)
    if (list.length === 0) return

    //抛入到皇冠队列进行盘口抓取
    if (list.length > 0) {
        await publish(
            'crown_odd',
            list.map((item) => JSON.stringify(item)),
            { priority: 10 },
            { maxPriority: 20 },
        )
    }
}

/**
 * 处理从皇冠取回盘口后的滚球盘数据
 * @param content
 */
async function processRockballCheck(content: string) {
    const { data, crown_match_id, extra } = JSON.parse(content) as CrownRobot.Output<{
        id: number
        crown_match_id: string
        source: [{ channel: 'rockball' | 'rockball2'; id: number }]
    }>

    if (!data || !extra) return

    //读取比赛
    const match = await Match.findOne({
        where: {
            crown_match_id,
        },
        attributes: ['id', 'match_time', 'has_score'],
    })
    if (!match) return
    if (match.match_time.valueOf() <= Date.now() - 7200000) return
    if (match.has_score) return

    const sources = Array.isArray(extra.source) ? extra.source : [{ channel: 'rockball', id: 0 }]

    for (const source of sources) {
        //读取这场比赛的滚球盘口
        const odds =
            source.channel === 'rockball'
                ? await RockballOdd.findAll({
                      where: {
                          match_id: match.id,
                          status: '',
                      },
                  })
                : await RockballOdd2.findAll({
                      where: {
                          match_id: match.id,
                          status: '',
                      },
                  })

        //对每个滚球盘口进行处理
        for (const odd of odds) {
            //查询皇冠抓来的数据里有没有对应的盘口
            const exists = findMatchedOdd(odd, data.odds).find((t) =>
                Decimal(odd.condition).eq(t.condition),
            )

            if (!exists) continue

            //判断一下水位是否达到要求
            if (Decimal(exists.value).lt(odd.value)) continue

            //水位达到要求了，那就开始插入推荐
            let promoted = await Promoted.findOne({
                where: {
                    match_id: match.id,
                    variety: odd.variety,
                    period: odd.period,
                    type: odd.type,
                    condition: odd.condition,
                    channel: source.channel,
                },
            })

            //已经创建过推荐了就不要了
            if (promoted) continue

            promoted = await Promoted.create({
                match_id: match.id,
                source_type: source.channel,
                source_id: odd.id,
                channel: source.channel,
                is_valid: odd.is_open,
                skip: odd.is_open ? '' : 'manual_close',
                week_day: getWeekDay(),
                week_id: 0,
                variety: odd.variety,
                period: odd.period,
                type: odd.type,
                condition: odd.condition,
                odd_type: getOddIdentification(odd.type),
                value: exists.value,
            })

            //标记这个盘口已经得到推荐
            odd.status = 'promoted'
            await odd.save()

            if (odd.is_open) {
                //如果打开了推荐，就抛到推荐队列
                await publish(
                    CONFIG.queues['send_promoted'],
                    JSON.stringify({ id: promoted.id, type: source.channel }),
                )
            }
        }
    }
}

/**
 * 开启滚球检查队列消费者
 */
async function startRockballConsume() {
    while (true) {
        const [promise] = consume(CONFIG.queues['rockball_check_after'], processRockballCheck)
        await promise
    }
}

if (require.main === module) {
    startRockballConsume()
    runLoop(10000, startRockballCheck)
}
