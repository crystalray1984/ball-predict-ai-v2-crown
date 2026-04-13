import { MatchTeamInfo } from '@/db'
import { InferAttributes } from 'sequelize'

// ==================== 类型定义 ====================

/** 原始比赛统计数据（来自 matches.json 的每个元素） */
export interface MatchStats extends InferAttributes<MatchTeamInfo> {
    period1_has_goals: number
}

/** 特征向量（长度为26的数值数组） */
export type FeatureVector = number[]

/** 决策树节点（序列化与运行时共用结构） */
export interface TreeNode {
    isLeaf: boolean
    prediction?: number // 仅叶子节点有效
    featureIndex?: number // 仅内部节点有效
    threshold?: number // 仅内部节点有效
    left?: TreeNode
    right?: TreeNode
}

/** 训练好的模型数据结构 */
export interface TrainedModel {
    trees: TreeNode[]
    mean: number[]
    std: number[]
    featureNames: string[]
    recommendedThreshold: number // 正类预测比例≥70%下的最佳阈值
}

// ==================== 配置参数 ====================
const FILTER_MIN_MATCHES = 3
const FILTER_MIN_MATCHES_30DAY = 1
const NUM_TREES = 100
const MAX_DEPTH = 8
const MIN_SAMPLES_SPLIT = 5
const THRESHOLD_SEARCH_STEP = 0.02
const MIN_POSITIVE_PREDICTION_RATIO = 0.7 // 最低正类预测比例

// ==================== 辅助函数 ====================
function safeDiv(a: number, b: number, defaultVal: number = 0): number {
    return b > 0 ? a / b : defaultVal
}

/** 过滤条件：两队都必须有足够的历史场次 */
export function filterMatch(m: MatchStats): boolean {
    if (m.team1_info.matches < FILTER_MIN_MATCHES || m.team2_info.matches < FILTER_MIN_MATCHES)
        return false
    if (
        m.team1_info.matches_30day < FILTER_MIN_MATCHES_30DAY ||
        m.team2_info.matches_30day < FILTER_MIN_MATCHES_30DAY
    )
        return false
    return true
}

// ==================== 特征工程 ====================
export function extractFeatures(m: MatchStats): FeatureVector {
    const t1_goals_p1_avg = safeDiv(m.team1_info.goals_scored_period1, m.team1_info.matches)
    const t2_goals_p1_avg = safeDiv(m.team2_info.goals_scored_period1, m.team2_info.matches)
    const t1_allowed_p1_avg = safeDiv(m.team1_info.goals_allowed_period1, m.team1_info.matches)
    const t2_allowed_p1_avg = safeDiv(m.team2_info.goals_allowed_period1, m.team2_info.matches)

    const t1_scored_ratio = safeDiv(m.team1_info.matches_scored_period1, m.team1_info.matches)
    const t2_scored_ratio = safeDiv(m.team2_info.matches_scored_period1, m.team2_info.matches)
    const t1_allowed_ratio = safeDiv(m.team1_info.matches_allowed_period1, m.team1_info.matches)
    const t2_allowed_ratio = safeDiv(m.team2_info.matches_allowed_period1, m.team2_info.matches)

    const t1_goals_p1_30 = safeDiv(
        m.team1_info.goals_scored_period1_30day,
        m.team1_info.matches_30day,
    )
    const t2_goals_p1_30 = safeDiv(
        m.team2_info.goals_scored_period1_30day,
        m.team2_info.matches_30day,
    )
    const t1_allowed_p1_30 = safeDiv(
        m.team1_info.goals_allowed_period1_30day,
        m.team1_info.matches_30day,
    )
    const t2_allowed_p1_30 = safeDiv(
        m.team2_info.goals_allowed_period1_30day,
        m.team2_info.matches_30day,
    )

    const t1_scored_ratio_30 = safeDiv(
        m.team1_info.matches_scored_period1_30day,
        m.team1_info.matches_30day,
    )
    const t2_scored_ratio_30 = safeDiv(
        m.team2_info.matches_scored_period1_30day,
        m.team2_info.matches_30day,
    )
    const t1_allowed_ratio_30 = safeDiv(
        m.team1_info.matches_allowed_period1_30day,
        m.team1_info.matches_30day,
    )
    const t2_allowed_ratio_30 = safeDiv(
        m.team2_info.matches_allowed_period1_30day,
        m.team2_info.matches_30day,
    )

    const attack_vs_defense = t1_goals_p1_avg * t2_allowed_p1_avg
    const defense_vs_attack = t1_allowed_p1_avg * t2_goals_p1_avg
    const both_attack = t1_goals_p1_avg + t2_goals_p1_avg
    const both_defense = t1_allowed_p1_avg + t2_allowed_p1_avg

    const t1_trend = safeDiv(t1_goals_p1_30, t1_goals_p1_avg, 1.0)
    const t2_trend = safeDiv(t2_goals_p1_30, t2_goals_p1_avg, 1.0)
    const t1_def_trend = safeDiv(t1_allowed_p1_30, t1_allowed_p1_avg, 1.0)
    const t2_def_trend = safeDiv(t2_allowed_p1_30, t2_allowed_p1_avg, 1.0)

    const diff_attack = t1_goals_p1_avg - t2_goals_p1_avg
    const diff_defense = t1_allowed_p1_avg - t2_allowed_p1_avg

    return [
        t1_goals_p1_avg,
        t2_goals_p1_avg,
        t1_allowed_p1_avg,
        t2_allowed_p1_avg,
        t1_scored_ratio,
        t2_scored_ratio,
        t1_allowed_ratio,
        t2_allowed_ratio,
        t1_goals_p1_30,
        t2_goals_p1_30,
        t1_allowed_p1_30,
        t2_allowed_p1_30,
        t1_scored_ratio_30,
        t2_scored_ratio_30,
        t1_allowed_ratio_30,
        t2_allowed_ratio_30,
        attack_vs_defense,
        defense_vs_attack,
        both_attack,
        both_defense,
        t1_trend,
        t2_trend,
        t1_def_trend,
        t2_def_trend,
        diff_attack,
        diff_defense,
    ]
}

// ==================== 标准化 ====================
function computeMeanStd(matrix: FeatureVector[]): { mean: number[]; std: number[] } {
    const n = matrix.length
    const d = matrix[0].length
    const mean: number[] = new Array(d).fill(0)
    const std: number[] = new Array(d).fill(0)

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < d; j++) {
            mean[j] += matrix[i][j]
        }
    }
    for (let j = 0; j < d; j++) mean[j] /= n

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < d; j++) {
            std[j] += Math.pow(matrix[i][j] - mean[j], 2)
        }
    }
    for (let j = 0; j < d; j++) {
        std[j] = Math.sqrt(std[j] / n)
        if (std[j] < 1e-8) std[j] = 1.0
    }
    return { mean, std }
}

// ==================== 随机森林实现 ====================
export class DecisionTreeNode {
    isLeaf: boolean = false
    prediction: number = 0
    featureIndex: number = 0
    threshold: number = 0
    left: DecisionTreeNode | null = null
    right: DecisionTreeNode | null = null
}

class RandomForest {
    private trees: DecisionTreeNode[] = []

    constructor(
        private numTrees: number,
        private maxDepth: number,
        private minSamplesSplit: number,
    ) {}

    private gini(y: number[]): number {
        if (y.length === 0) return 0
        const pos = y.filter((v) => v === 1).length
        const p1 = pos / y.length
        const p0 = 1 - p1
        return 1 - p1 * p1 - p0 * p0
    }

    private getRandomFeatures(numFeatures: number): number[] {
        const n = Math.floor(Math.sqrt(numFeatures))
        const indices: number[] = []
        while (indices.length < n) {
            const idx = Math.floor(Math.random() * numFeatures)
            if (!indices.includes(idx)) indices.push(idx)
        }
        return indices.sort((a, b) => a - b)
    }

    private bestSplit(
        X: FeatureVector[],
        y: number[],
        featureIndices: number[],
    ): { bestFeature: number | null; bestThreshold: number | null; bestGain: number } {
        let bestGain = -1
        let bestFeature: number | null = null
        let bestThreshold: number | null = null
        const currentGini = this.gini(y)

        for (const featIdx of featureIndices) {
            const values = X.map((row) => row[featIdx])
            const uniqueVals = [...new Set(values)].sort((a, b) => a - b)
            if (uniqueVals.length <= 1) continue

            for (let i = 0; i < uniqueVals.length - 1; i++) {
                const threshold = (uniqueVals[i] + uniqueVals[i + 1]) / 2
                const leftY: number[] = []
                const rightY: number[] = []
                for (let j = 0; j < X.length; j++) {
                    if (X[j][featIdx] <= threshold) leftY.push(y[j])
                    else rightY.push(y[j])
                }
                if (leftY.length < this.minSamplesSplit || rightY.length < this.minSamplesSplit)
                    continue

                const giniLeft = this.gini(leftY)
                const giniRight = this.gini(rightY)
                const weightedGini =
                    (leftY.length * giniLeft + rightY.length * giniRight) / y.length
                const gain = currentGini - weightedGini

                if (gain > bestGain) {
                    bestGain = gain
                    bestFeature = featIdx
                    bestThreshold = threshold
                }
            }
        }
        return { bestFeature, bestThreshold, bestGain }
    }

    private buildTree(X: FeatureVector[], y: number[], depth: number): DecisionTreeNode {
        const node = new DecisionTreeNode()

        if (depth >= this.maxDepth || y.length < this.minSamplesSplit || this.gini(y) === 0) {
            node.isLeaf = true
            const pos = y.filter((v) => v === 1).length
            node.prediction = pos / y.length
            return node
        }

        const featureIndices = this.getRandomFeatures(X[0].length)
        const { bestFeature, bestThreshold, bestGain } = this.bestSplit(X, y, featureIndices)

        if (bestFeature === null || bestThreshold === null || bestGain <= 0) {
            node.isLeaf = true
            const pos = y.filter((v) => v === 1).length
            node.prediction = pos / y.length
            return node
        }

        const leftX: FeatureVector[] = []
        const leftY: number[] = []
        const rightX: FeatureVector[] = []
        const rightY: number[] = []

        for (let i = 0; i < X.length; i++) {
            if (X[i][bestFeature] <= bestThreshold) {
                leftX.push(X[i])
                leftY.push(y[i])
            } else {
                rightX.push(X[i])
                rightY.push(y[i])
            }
        }

        node.featureIndex = bestFeature
        node.threshold = bestThreshold
        node.left = this.buildTree(leftX, leftY, depth + 1)
        node.right = this.buildTree(rightX, rightY, depth + 1)
        return node
    }

    fit(X: FeatureVector[], y: number[]): void {
        for (let t = 0; t < this.numTrees; t++) {
            const sampleIndices: number[] = []
            for (let i = 0; i < X.length; i++) {
                sampleIndices.push(Math.floor(Math.random() * X.length))
            }
            const X_sample = sampleIndices.map((idx) => X[idx])
            const y_sample = sampleIndices.map((idx) => y[idx])

            const tree = this.buildTree(X_sample, y_sample, 0)
            this.trees.push(tree)
        }
    }

    private predictOne(tree: DecisionTreeNode, x: FeatureVector): number {
        let node: DecisionTreeNode = tree
        while (!node.isLeaf) {
            if (node.left && node.right && x[node.featureIndex] <= node.threshold) {
                node = node.left
            } else if (node.right) {
                node = node.right
            } else {
                break
            }
        }
        return node.prediction
    }

    predictProba(x: FeatureVector): number {
        let sum = 0
        for (const tree of this.trees) {
            sum += this.predictOne(tree, x)
        }
        return sum / this.trees.length
    }

    predictProbas(X: FeatureVector[]): number[] {
        return X.map((x) => this.predictProba(x))
    }

    getTrees(): DecisionTreeNode[] {
        return this.trees
    }
}

// ==================== 序列化辅助函数 ====================
function serializeTree(node: DecisionTreeNode): TreeNode {
    if (node.isLeaf) {
        return { isLeaf: true, prediction: node.prediction }
    }
    return {
        isLeaf: false,
        featureIndex: node.featureIndex,
        threshold: node.threshold,
        left: node.left ? serializeTree(node.left) : undefined,
        right: node.right ? serializeTree(node.right) : undefined,
    }
}

export function deserializeTree(obj: TreeNode): DecisionTreeNode {
    const node = new DecisionTreeNode()
    node.isLeaf = obj.isLeaf
    if (obj.isLeaf) {
        node.prediction = obj.prediction!
    } else {
        node.featureIndex = obj.featureIndex!
        node.threshold = obj.threshold!
        node.left = obj.left ? deserializeTree(obj.left) : null
        node.right = obj.right ? deserializeTree(obj.right) : null
    }
    return node
}

// ==================== 导出的训练函数 ====================
/**
 * 训练上半场进球预测模型
 * @param matches 原始比赛统计数据数组
 * @returns 训练好的模型数据，包含树结构、标准化参数、特征名称及推荐阈值
 */
export function trainModel(matches: MatchStats[]): TrainedModel {
    // 1. 过滤
    const filtered = matches.filter(filterMatch)
    console.log(
        `原始: ${matches.length}, 过滤后: ${filtered.length} (${((filtered.length / matches.length) * 100).toFixed(2)}%)`,
    )

    // 2. 特征提取
    const X = filtered.map((m) => extractFeatures(m))
    const y = filtered.map((m) => m.period1_has_goals)

    // 3. 标准化
    const { mean, std } = computeMeanStd(X)
    const X_norm = X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]))

    // 4. 训练随机森林
    console.log('开始训练随机森林...')
    const rf = new RandomForest(NUM_TREES, MAX_DEPTH, MIN_SAMPLES_SPLIT)
    rf.fit(X_norm, y)
    console.log('训练完成。')

    // 5. 序列化模型树
    const trees = rf.getTrees().map((tree) => serializeTree(tree))
    const featureNames = [
        't1_goals_p1_avg',
        't2_goals_p1_avg',
        't1_allowed_p1_avg',
        't2_allowed_p1_avg',
        't1_scored_ratio',
        't2_scored_ratio',
        't1_allowed_ratio',
        't2_allowed_ratio',
        't1_goals_p1_30',
        't2_goals_p1_30',
        't1_allowed_p1_30',
        't2_allowed_p1_30',
        't1_scored_ratio_30',
        't2_scored_ratio_30',
        't1_allowed_ratio_30',
        't2_allowed_ratio_30',
        'attack_vs_defense',
        'defense_vs_attack',
        'both_attack',
        'both_defense',
        't1_trend',
        't2_trend',
        't1_def_trend',
        't2_def_trend',
        'diff_attack',
        'diff_defense',
    ]

    // 6. 计算训练集上的预测概率，寻找最佳阈值（正类预测比例 ≥ MIN_POSITIVE_PREDICTION_RATIO）
    const probs = rf.predictProbas(X_norm)
    let bestThreshold = 0.5
    let bestAccuracy = 0

    for (let thresh = 0.0; thresh <= 1.0; thresh += THRESHOLD_SEARCH_STEP) {
        const preds = probs.map((p) => (p >= thresh ? 1 : 0))
        const predPosRatio = preds.filter((p) => p === 1).length / preds.length

        if (predPosRatio < MIN_POSITIVE_PREDICTION_RATIO) continue

        let correct = 0
        for (let i = 0; i < y.length; i++) {
            if (preds[i] === y[i]) correct++
        }
        const acc = correct / y.length
        if (acc > bestAccuracy) {
            bestAccuracy = acc
            bestThreshold = thresh
        }
    }

    console.log(
        `推荐阈值: ${bestThreshold.toFixed(2)} (正类预测比例 ≥ ${(MIN_POSITIVE_PREDICTION_RATIO * 100).toFixed(0)}%, 准确率: ${(bestAccuracy * 100).toFixed(2)}%)`,
    )

    return { trees, mean, std, featureNames, recommendedThreshold: bestThreshold }
}
