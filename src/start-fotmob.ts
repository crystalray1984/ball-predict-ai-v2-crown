import { Op, QueryTypes } from 'sequelize'
import { runLoop } from './common/helpers'
import { db, VMatch } from './db'
import dayjs from 'dayjs'

/**
 * 启动fotmob.com赛果采集进程
 */
async function startFotmob() {
    const now = new Date()
    const startDay = dayjs(now).startOf('day').subtract(3, 'days')

    //读取最近3天的比赛
    const matches = await db.query(
        {
            query: `
            SELECT
                *
            FROM
                v_match
            WHERE
                match_time BETWEEN ? AND ?
                AND (has_score = 0 OR fotmob_match_id = '')
                AND "team1_i18n_name" ?| ARRAY['en']
                AND "team2_i18n_name" ?| ARRAY['en']
            `,
            values: [],
        },
        {
            type: QueryTypes.SELECT,
            model: VMatch,
        },
    )
}

if (require.main === module) {
    runLoop(120000, startFotmob)
}
