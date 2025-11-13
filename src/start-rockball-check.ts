import Decimal from 'decimal.js'
import { QueryTypes } from 'sequelize'
import { getOddIdentification, runLoop } from './common/helpers'
import { consume, publish } from './common/rabbitmq'
import { CONFIG } from './config'
import { findMatchedOdd } from './crown'
import { db, Match, RockballOdd, RockballPromoted } from './db'

/**
 * 开启滚球检查
 */
async function startRockballCheck() {
    //读取所有需要检查的滚球盘
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
            "match"
        WHERE
            "match"."match_time" BETWEEN ? AND ?
            AND "match".id IN
            (
                SELECT
                    match_id
                FROM
                    "rockball_odd"
                WHERE
                    status = ?
            )
        `,
            values: [new Date(Date.now() - 7200000), new Date(), ''],
        },
        {
            type: QueryTypes.SELECT,
        },
    )

    console.log('需要抓取滚球盘的比赛', matches.length)
    if (matches.length === 0) return

    //抛入到皇冠队列进行盘口抓取
    await publish(
        'crown_odd',
        matches.map((match) =>
            JSON.stringify({
                crown_match_id: match.crown_match_id,
                next: CONFIG.queues['rockball_check_after'],
                extra: match,
            }),
        ),
    )
}

/**
 * 处理从皇冠取回盘口后的滚球盘数据
 * @param content
 */
async function processRockballCheck(content: string) {
    const { extra, data } = JSON.parse(content) as CrownRobot.Output<{
        id: number
        crown_match_id: string
    }>

    if (!extra) return
    if (!data) return

    //读取比赛
    const match = await Match.findOne({
        where: {
            id: extra.id,
        },
        attributes: ['match_time', 'has_score'],
    })
    if (!match) return
    if (match.match_time.valueOf() <= Date.now() - 7200000) return
    if (match.has_score) return

    //读取这场比赛的滚球盘口
    const odds = await RockballOdd.findAll({
        where: {
            match_id: extra.id,
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
        let promoted = await RockballPromoted.findOne({
            where: {
                match_id: extra.id,
                variety: odd.variety,
                period: odd.period,
                type: odd.type,
                condition: odd.condition,
            },
            attributes: ['id'],
        })

        //已经创建过推荐了就不要了
        if (promoted) continue

        //插入推荐
        promoted = await RockballPromoted.create({
            match_id: extra.id,
            odd_id: odd.id,
            variety: odd.variety,
            period: odd.period,
            type: odd.type,
            condition: odd.condition,
            value: exists.value,
            odd_type: getOddIdentification(odd.type),
            is_valid: odd.is_open,
        })

        //标记这个盘口已经得到推荐
        odd.status = 'promoted'
        await odd.save()

        if (odd.is_open) {
            //如果打开了推荐，就抛到推荐队列
            await publish(
                CONFIG.queues['send_promoted'],
                JSON.stringify({ id: promoted.id, type: 'rockball_promoted' }),
            )
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
    runLoop(60000, startRockballCheck)
}
