import { db, MatchTeamInfo, Promoted } from '@/db'
import { InferAttributes, QueryTypes } from 'sequelize'
import { getOddResult } from './common/helpers'
import { predictPeriod1Goals } from './predict'

async function main() {
    //重建滚球5数据
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

    for (const match of list) {
        console.log(match.match_id)

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

        const [result] = predictPeriod1Goals(match)

        if (!result) continue

        //判断是否存在
        const exists = await Promoted.findOne({
            where: {
                match_id: match.match_id,
                channel: 'rockball5',
            },
            attributes: ['id'],
        })
        if (exists) continue

        //计算赛果和手数
        const oddResult = getOddResult(
            {
                variety: 'goal',
                period: 'period1',
                type: 'over',
                condition: '0.5',
                value: '1.88',
            },
            {
                score1: match.score1_period1,
                score2: match.score2_period1,
                score1_period1: match.score1_period1,
                score2_period1: match.score2_period1,
            } as any,
        )!

        //插入数据
        await Promoted.create({
            match_id: match.match_id,
            source_type: '',
            source_id: 0,
            channel: 'rockball5',
            is_valid: 1,
            week_day: 0,
            week_id: 0,
            variety: 'goal',
            period: 'period1',
            type: 'over',
            odd_type: 'sum',
            condition: '0.5',
            value: '1.88',
            score: (match.score1_period1 + match.score2_period1).toString(),
            score1: match.score1_period1,
            score2: match.score2_period1,
            result: oddResult.result,
            result_profit: oddResult.result_profit,
            result_value: oddResult.result_value,
        })
    }
}

main()
    .then(() => process.exit())
    .catch((err) => {
        console.error(err)
        process.exit()
    })
