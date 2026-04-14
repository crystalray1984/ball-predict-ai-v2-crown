import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { QueryTypes } from 'sequelize'
import { ROOT } from './config'
import { db } from './db'
import { MODEL_PATH, predictPeriod1Goals } from './predict'
import { MatchStatsForTrain } from './predict/model'

type TrainMatchData = MatchStatsForTrain & {
    match_id: number
    score1_period1: number
    score2_period1: number
}

const MATCH_BATCH_SIZE = 2000

/**
 * 获取训练用的比赛数据
 */
async function getMatches(promoted: boolean) {
    const promotedSql = promoted
        ? `
AND a.id IN (
SELECT
match_id
FROM
promoted
WHERE
channel IN ('rockball', 'rockball2', 'rockball3', 'rockball4', 'rockball5')
AND "period" = 'period1' AND "condition" = '0.5' AND "type" = 'over'
)
    `
        : ''
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
  AND b.match_id > ?
  ${promotedSql}
ORDER BY
  b.match_id
LIMIT ${MATCH_BATCH_SIZE}
`
    let lastMatchId = 0

    let matches: TrainMatchData[] = []

    while (true) {
        const list = await db.query<TrainMatchData>(
            {
                query: sql,
                values: [lastMatchId],
            },
            {
                type: QueryTypes.SELECT,
            },
        )

        if (list.length === 0) break

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
        })

        matches = matches.concat(list)
        lastMatchId = list[list.length - 1].match_id
        console.log('读取比赛id', lastMatchId)

        if (list.length < MATCH_BATCH_SIZE) break
    }

    return matches
}

/**
 * 使用go模型训练器
 */
function trainModelByGo(matchesJsonPath: string, modelPath: string) {
    return new Promise<void>((success, reject) => {
        const cwd = resolve(ROOT, './runtime')
        let executable = 'train-model' + (process.platform === 'win32' ? '.exe' : '')
        executable = resolve(cwd, executable)
        spawn(executable, ['-input', matchesJsonPath, '-output', modelPath], {
            stdio: [process.stdin, process.stdout, process.stderr],
        })
            .on('error', reject)
            .on('exit', success)
    })
}

/**
 * 训练并保存模型数据
 */
export async function startTrain() {
    //先读取用于训练的数据
    let matchesFull = await getMatches(false)

    //保存训练用的数据
    const matchesPath = resolve(ROOT, './runtime/matches.json')
    await writeFile(matchesPath, JSON.stringify(matchesFull), 'utf-8')

    //执行模型训练
    await trainModelByGo(matchesPath, MODEL_PATH)

    //原数据校验
    console.log('原始数据校验', matchesFull.length)
    verifyByMatches(matchesFull)
    matchesFull = []

    const promoted = await getMatches(true)
    console.log('有效数据校验', promoted.length)
    verifyByMatches(promoted)
}

/**
 * 根据数据集校验模型
 * @param matches
 */
function verifyByMatches(matches: MatchStatsForTrain[]) {
    if (matches.length === 0) return

    let valid = 0
    let right = 0

    matches.forEach((match) => {
        const [promote] = predictPeriod1Goals(match, 0.7)
        if (promote) {
            valid++
            if (match.period1_has_goals) {
                right++
            }
        }
    })

    let rightPercent = valid > 0 ? (right * 100) / valid : 0

    console.log(
        `样本总数${matches.length}`,
        `推荐数=${valid}`,
        `推荐率=${((valid * 100) / matches.length).toFixed(2)}%`,
        `正确率=${rightPercent.toFixed(2)}%`,
    )
}

if (require.main === module) {
    startTrain()
        .then(() => process.exit())
        .catch((err) => {
            console.error(err)
            process.exit(-1)
        })
}
