import { predictPeriod1Goals } from '@/predict'
import { InferAttributes, QueryTypes } from 'sequelize'
import { db, MatchTeamInfo } from './db'

async function main() {
    const sql = `
SELECT
  b.*,
  a.score1_period1,
  a.score2_period1
FROM
  "match" AS a
INNER JOIN
  match_team_info AS b ON b.match_id = a.id
WHERE
  a.has_score = 1
  AND a.id IN (
   SELECT
    match_id
  FROM
    promoted
  WHERE
    channel LIKE 'rockball%'
    AND "period" = 'period1' AND "condition" = '0.5' AND "type" = 'over'
  )
`
    const list = await db.query<
        InferAttributes<MatchTeamInfo> & {
            score1_period1: number
            score2_period1: number
            period1_has_goals: number
        }
    >(sql, {
        type: QueryTypes.SELECT,
    })

    let right = 0
    let promoted = 0

    //校验数据
    list.forEach((match) => {
        const team1_info =
            typeof match.team1_info === 'string'
                ? (JSON.parse(match.team1_info) as TeamInfo)
                : match.team1_info
        const team2_info =
            typeof match.team2_info === 'string'
                ? (JSON.parse(match.team2_info) as TeamInfo)
                : match.team2_info

        match.team1_info = team1_info
        match.team2_info = team2_info
        match.period1_has_goals =
            (match.score1_period1 ?? 0) + (match.score2_period1 ?? 0) > 0 ? 1 : 0

        const [result] = predictPeriod1Goals(match)
        if (result) {
            promoted++
            const period1_has_goals = result ? 1 : 0
            if (period1_has_goals === match.period1_has_goals) {
                right++
            }
        }
        console.log(match.match_id)
    })

    console.log(`比赛总数`, list.length, '推荐总数', promoted, `正确率`, right / promoted)
}

main()
    .then(() => process.exit())
    .catch((err) => {
        console.error(err)
        process.exit(-1)
    })
