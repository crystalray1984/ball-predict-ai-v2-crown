import { ROOT } from '@/config'
import { db, MatchTeamInfo } from '@/db'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { InferAttributes, QueryTypes } from 'sequelize'
import {
    DecisionTreeNode,
    deserializeTree,
    extractFeatures,
    filterMatch,
    MatchStats,
    TrainedModel,
    trainModel,
} from './model'

/**
 * 模型的保存路径
 */
const MODEL_PATH = resolve(ROOT, './runtime/predict_period1.json')

/**
 * 预测函数
 */
type Predictor = (match: MatchStats) => [boolean, number]

/**
 * 反序列化模型数据
 */
function deserializeModel(model: TrainedModel) {
    // 3. 反序列化所有树
    const trees = model.trees.map((treeObj) => deserializeTree(treeObj))

    return (match: MatchStats): [boolean, number] => {
        // 1. 提取原始特征
        const rawFeatures = extractFeatures(match)

        // 2. 标准化
        const normalizedFeatures = rawFeatures.map((v, i) => (v - model.mean[i]) / model.std[i])

        // 4. 随机森林投票
        let sum = 0
        for (const tree of trees) {
            let node: DecisionTreeNode = tree
            while (!node.isLeaf) {
                if (
                    node.left &&
                    node.right &&
                    normalizedFeatures[node.featureIndex] <= node.threshold
                ) {
                    node = node.left
                } else if (node.right) {
                    node = node.right
                } else {
                    break
                }
            }
            sum += node.prediction
        }
        const prob = sum / trees.length
        return [prob > model.recommendedThreshold, prob]
    }
}

let predict: Predictor | undefined = undefined

/**
 * 加载模型
 */
function loadModel() {
    if (!existsSync(MODEL_PATH)) return

    const model = JSON.parse(readFileSync(MODEL_PATH, 'utf-8'))
    return deserializeModel(model)
}

/**
 * 训练并保存模型数据
 */
export async function trainAndSaveModel() {
    //先读取用于训练的数据
    //导出所有的队伍数据
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
    let list = await db.query<
        InferAttributes<MatchTeamInfo> & {
            score1_period1: number
            score2_period1: number
            period1_has_goals: number
        }
    >(sql, {
        type: QueryTypes.SELECT,
    })

    list = list.filter((match) => {
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

        return filterMatch(match)
    })

    //训练模型
    const model = trainModel(list)

    //写入模型JSON文件
    await writeFile(MODEL_PATH, JSON.stringify(model, null, 2), 'utf-8')
}

/**
 * 预测比赛上半场是否应该有进球
 * @param match
 */
export function predictPeriod1Goals(match: MatchStats): [boolean, number] {
    //检测比赛是否属于满足条件的比赛
    if (!filterMatch(match)) {
        return [false, 0]
    }

    if (!predict) {
        //还未有数据就加载模型
        predict = loadModel()
    }

    if (!predict) {
        return [false, 0]
    }

    return predict(match)
}
