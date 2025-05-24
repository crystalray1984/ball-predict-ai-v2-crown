import { QueryTypes } from 'sequelize'
import { db, Match } from './db'
import dayjs from 'dayjs'
import { groupBy } from 'lodash'
import { findMatch, FindMatchResult, getFinalMatches, getMatchScore } from './titan007'

//补充所有赛事的赛果
async function main() {
    //先查询数据库中所有没有赛果的比赛
    const matches = await db.query<{
        id: number
        titan007_match_id: string
        titan007_swap: number
        match_time: Date
        team1_name: string
        team2_name: string
    }>(
        {
            query: `
            SELECT
                id,
                titan007_match_id,
                titan007_swap,
                match_time,
                team1_name,
                team2_name
            FROM
                v_match
            WHERE
                match_time < ?
                AND
                has_score = 0
            `,
            values: [dayjs().startOf('day').toDate()],
        },
        {
            type: QueryTypes.SELECT,
        },
    )

    //将比赛按日分组
    const grouped = groupBy(matches, (match) => dayjs(match.match_time).format('YYYYMMDD'))

    //爬取比赛
    for (const [date, list] of Object.entries(grouped)) {
        console.log('处理赛果', date, list.length)

        const finalMatches = await getFinalMatches(dayjs(list[0].match_time))
        //赛果匹配
        for (const match of matches) {
            let found: FindMatchResult | undefined = undefined
            if (match.titan007_match_id) {
                //比赛原本有球探网id

                const exists = finalMatches.find((t) => t.match_id === match.titan007_match_id)
                if (exists) {
                    if (exists.state !== -1) {
                        //比赛有异常，跳过
                        continue
                    }
                } else {
                    console.log(
                        '未找到匹配的比赛1',
                        match.id,
                        match.match_time,
                        match.team1_name,
                        match.team2_name,
                    )
                    continue
                }

                found = {
                    ...exists,
                    swap: match.titan007_swap === 1,
                }
            } else {
                //比赛没有球探网id
                const exists = findMatch(match, finalMatches)
                if (exists) {
                    if (exists.state !== -1) {
                        //比赛有异常，跳过
                        continue
                    }
                } else {
                    console.log(
                        '未找到匹配的比赛2',
                        match.id,
                        match.match_time,
                        match.team1_name,
                        match.team2_name,
                    )
                    continue
                }

                found = exists
            }

            //抓取赛果
            try {
                const score = await getMatchScore(found.match_id, found.swap)

                //更新赛果
                await Match.update(
                    {
                        has_score: 1,
                        score1: score.score1,
                        score2: score.score2,
                        corner1: score.corner1,
                        corner2: score.corner2,
                        has_period1_score: 1,
                        score1_period1: score.score1_period1,
                        score2_period1: score.score2_period1,
                        corner1_period1: score.corner1_period1,
                        corner2_period1: score.corner2_period1,
                    },
                    {
                        where: {
                            id: match.id,
                        },
                        returning: false,
                    },
                )

                //更新投注
                Object.assign(match, score)
                console.log('更新赛果', match.id, date, match.team1_name, match.team2_name)
            } catch (err) {
                console.error(err)
            }
        }
    }
}

main().finally(() => process.exit())
