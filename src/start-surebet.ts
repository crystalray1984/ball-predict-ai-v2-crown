import { runLoop } from '@/common/helpers'
import { createPublisher, Publisher } from '@/common/rabbitmq'
import { db, Match, Odd } from '@/db'
import { getSurebets } from '@/surebet'
import { Op, QueryTypes } from 'sequelize'

/**
 * 开启surebet数据抓取
 */
export async function startSurebet() {
    //读取surebet数据
    const list = await getSurebets()
    console.log('满足条件的surebet数据', list.length)
    if (list.length === 0) return

    let publisher = undefined as unknown as Publisher

    for (const surebet of list) {
        //先确定盘口是否存在
        const exists = await Odd.findOne({
            where: {
                crown_match_id: surebet.crown_match_id,
                variety: surebet.type.variety,
                period: surebet.type.period,
                condition: surebet.type.condition,
                type: surebet.type.type,
            },
        })
        if (exists && exists.status !== '') {
            //已经有盘口而且这个盘口的状态不为空那么跳过
            continue
        }

        //判断比赛，如果比赛存在且状态为已结算那么也跳过
        const match = await Match.findOne({
            where: {
                crown_match_id: surebet.crown_match_id,
            },
            attributes: ['id', 'status'],
        })
        if (match && match.status !== '') {
            continue
        }

        //把盘口抛到消息队列进行第一次比对
        if (!publisher) {
            publisher = await createPublisher()
        }

        console.log('抛到消息队列进行第一次比对', surebet.crown_match_id)
        await publisher.publish('ready_check', JSON.stringify(surebet))
    }

    if (publisher) {
        await publisher.close()
    }
}

/**
 * 寻找即将开赛的比赛，把数据抛入到皇冠的二次处理队列中
 */
export async function processNearlyMatches() {
    //先查询需要处理的比赛
    const matches = await db.query<{
        id: number
        crown_match_id: string
    }>(
        {
            query: `
        SELECT
            DISTINCT
            a.id,
        FROM
            \`match\` AS a
        INNER JOIN
            odd ON odd.match_id = a.id AND odd.status = ?
        WHERE
            a.match_time >= ?
            AND a.match_time <= ?
            AND a.status = ?
        ORDER BY
            a.match_time
        `,
            values: [
                'ready',
                new Date(Date.now()), //已经开赛的比赛不抓取
                new Date(Date.now() + 300000), //只抓取5分内开赛的比赛
                '', //只选择还未结算的比赛
            ],
        },
        {
            type: QueryTypes.SELECT,
        },
    )
    console.log('需要二次比对的比赛', matches.length)
    if (matches.length === 0) return
}

if (require.main === module) {
    runLoop(60000, startSurebet)
}
