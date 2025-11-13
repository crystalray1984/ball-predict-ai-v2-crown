import { QueryTypes } from 'sequelize'
import { runLoop } from './common/helpers'
import { consume } from './common/rabbitmq'
import { CONFIG } from './config'
import { db } from './db'

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
            "match"."match_time" BETWEEN (? AND ?)
            AND "match".id IN
            (
                SELECT
                    match_id
                FROM
                    "rockball_odd"
            )
        `,
            values: [new Date(Date.now() - 7200000), new Date()],
        },
        {
            type: QueryTypes.SELECT,
        },
    )

    console.log('需要抓取滚球盘的比赛', matches.length)
    if (matches.length === 0) return

    //抛入到皇冠队列进行盘口抓取
}

async function processRockballCheck(content: string) {}

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
    startRockballCheck()
    runLoop(60000, startRockballCheck)
}
