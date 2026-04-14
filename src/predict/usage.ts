import { ROOT } from '@/config'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
    DecisionTreeNode,
    deserializeTree,
    extractFeatures,
    filterMatch,
    MatchStats,
    MatchStatsForTrain,
    TrainedModel,
    trainModel,
} from './model'

/**
 * 模型的保存路径
 */
export const MODEL_PATH = resolve(ROOT, './runtime/predict_period1.json')

/**
 * 预测函数
 */
type Predictor = (match: MatchStats, threshold?: number) => [boolean, number]

/**
 * 反序列化模型数据
 */
function deserializeModel(model: TrainedModel) {
    // 3. 反序列化所有树
    const trees = model.trees.map((treeObj) => deserializeTree(treeObj))

    return (match: MatchStats, threshold?: number): [boolean, number] => {
        // 1. 提取原始特征
        const rawFeatures = extractFeatures(match)

        // 2. 标准化
        const normalizedFeatures = rawFeatures.map((v, i) => (v - model.mean[i]) / model.std[i])

        if (typeof threshold !== 'number') {
            threshold = model.recommendedThreshold
        }

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
        return [prob > threshold, prob]
    }
}

let predict: Predictor | undefined = undefined

/**
 * 加载模型
 */
function loadModel(modelPath = MODEL_PATH) {
    if (!existsSync(modelPath)) return

    const model = JSON.parse(readFileSync(modelPath, 'utf-8'))
    return deserializeModel(model)
}

/**
 * 训练并保存模型
 * @param matches
 */
export async function trainAndSaveModel(matches: MatchStatsForTrain[], modelPath = MODEL_PATH) {
    //训练模型
    const model = trainModel(matches)
    //写入模型JSON文件
    await writeFile(MODEL_PATH, JSON.stringify(model, null, 2), 'utf-8')
}

/**
 * 预测比赛上半场是否应该有进球
 * @param match
 */
export function predictPeriod1Goals(
    match: MatchStats,
    model?: string,
    threshold?: number,
): [boolean, number]
export function predictPeriod1Goals(match: MatchStats, threshold: number): [boolean, number]
export function predictPeriod1Goals(
    match: MatchStats,
    modelOrThreshold?: string | number,
    threshold?: number,
): [boolean, number] {
    let model: string | undefined = undefined
    //确定阈值
    if (typeof modelOrThreshold === 'number') {
        threshold = modelOrThreshold
    } else if (typeof modelOrThreshold === 'string') {
        model = modelOrThreshold
    }

    //检测比赛是否属于满足条件的比赛
    if (!filterMatch(match)) {
        return [false, 0]
    }

    if (!predict) {
        //还未有数据就加载模型
        predict = loadModel(model)
    }

    if (!predict) {
        return [false, 0]
    }

    return predict(match, threshold)
}
