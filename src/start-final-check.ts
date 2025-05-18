import { runLoop } from '@/common/helpers'
import { createPublisher } from '@/common/rabbitmq'
import { db } from '@/db'
import { QueryTypes } from 'sequelize'

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

    //把数据抛入队列
    const publisher = await createPublisher()
    for (const match of matches) {
        console.log('进行二次对比的比赛', match)
        await publisher.publish('final_check', JSON.stringify(match))
    }
    //关闭队列
    await publisher.close()
}

if (require.main === module) {
    runLoop(60000, processNearlyMatches)
}
