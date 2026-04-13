import { db, VMatch } from '@/db'
import dayjs from 'dayjs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { InferAttributes, QueryTypes } from 'sequelize'

async function main() {
    //导出所有的队伍数据
    const sql = `
SELECT
  a.*,
  b.team1_info,
  b.team2_info
FROM
  v_match AS a
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
    channel IN ('rockball', 'rockball2', 'rockball3', 'rockball4')
    AND "period" = 'period1' AND "condition" = '0.5' AND "type" = 'over'
  )
ORDER BY
  a.id
`
    const list = await db.query<
        InferAttributes<VMatch> & { team1_info: string | TeamInfo; team2_info: string | TeamInfo }
    >(sql, {
        type: QueryTypes.SELECT,
    })

    const output: any[] = []
    const output1: any[] = []

    for (const match of list) {
        const team1_info =
            typeof match.team1_info === 'string'
                ? (JSON.parse(match.team1_info) as TeamInfo)
                : match.team1_info
        const team2_info =
            typeof match.team2_info === 'string'
                ? (JSON.parse(match.team2_info) as TeamInfo)
                : match.team2_info
        const match_time = dayjs(match.match_time)

        const base_info = {
            id: match.id,
            ...Object.fromEntries(
                Object.entries(team1_info).map(([name, value]) => [`team1_${name}`, value]),
            ),
            ...Object.fromEntries(
                Object.entries(team2_info).map(([name, value]) => [`team2_${name}`, value]),
            ),
            period1_has_goals:
                (match.score1_period1 ?? 0) + (match.score2_period1 ?? 0) > 0 ? 1 : 0,
        }

        const extend_info = {
            ...base_info,
            tournament_id: match.tournament_id,
            tournament_name: match.tournament_name,
            match_time: match_time.format('YYYY-MM-DD HH:mm'),
            team1_id: match.team1_id,
            team1_name: match.team1_name,
            team2_id: match.team2_id,
            team2_name: match.team2_name,
        }

        output.push(base_info)
        output1.push(extend_info)
    }

    await writeFile(resolve(__dirname, '../matches.json'), JSON.stringify(output, null, 4), 'utf-8')
    await writeFile(
        resolve(__dirname, '../matches_full.json'),
        JSON.stringify(output1, null, 4),
        'utf-8',
    )
}

main()
    .then(() => process.exit())
    .catch((err) => {
        console.error(err)
        process.exit()
    })
