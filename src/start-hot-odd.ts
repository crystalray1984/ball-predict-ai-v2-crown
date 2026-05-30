import { QueryTypes } from 'sequelize'
import { CROWN_ODD_QUEUE } from './common/constants'
import { runLoop } from './common/helpers'
import { publish } from './common/rabbitmq'
import { db } from './db'

/**
 * 更新皇冠热门比赛的盘口数据
 */
async function startHotOddTasks() {
    //找到需要采集的热门比赛盘口
    const matches = await db.query<{
        crown_match_id: string
    }>(
        `
            SELECT
                a.crown_match_id
            FROM
            (
                SELECT
                    "match".crown_match_id,
                    crown_odd_record.created_at AS crown_odd_record_created_at
                FROM
                    "match"
                LEFT JOIN crown_odd_record
                    ON crown_odd_record.crown_match_id = "match".crown_match_id
                    AND crown_odd_record.is_last = 1
                    AND crown_odd_record.show_type = 'today'
                WHERE
                    "match".match_time > CURRENT_TIMESTAMP + interval '5 minutes'
                    AND "match".match_time < CURRENT_TIMESTAMP + interval '12 hours'
            ) AS a
            WHERE
                a.crown_odd_record_created_at IS NULL OR a.crown_odd_record_created_at < CURRENT_TIMESTAMP - interval '5 minutes'
            `,
        {
            type: QueryTypes.SELECT,
            raw: true,
        },
    )

    console.log('需要采集皇冠盘口的比赛', JSON.stringify(matches.map((t) => t.crown_match_id)))
    if (matches.length === 0) return

    const queueData = matches.map((row) => JSON.stringify(row))

    await publish(CROWN_ODD_QUEUE, queueData)
}

if (require.main === module) {
    runLoop(180000, startHotOddTasks)
}
