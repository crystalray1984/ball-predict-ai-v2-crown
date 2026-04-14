package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"math/rand"
	"os"
	"sort"
	"time"
    "sync"
)

// -------------------- 数据结构定义 --------------------

// 输入数据格式
type InputMatch struct {
	ID               int       `json:"id"`
	Team1Info        TeamStats `json:"team1_info"`
	Team2Info        TeamStats `json:"team2_info"`
	Period1HasGoals  int       `json:"period1_has_goals"`
}

type TeamStats struct {
	Matches                      int `json:"matches"`
	GoalsScored                  int `json:"goals_scored"`
	GoalsAllowed                 int `json:"goals_allowed"`
	Matches30Day                 int `json:"matches_30day"`
	MatchesScored                int `json:"matches_scored"`
	MatchesAllowed               int `json:"matches_allowed"`
	GoalsScored30Day             int `json:"goals_scored_30day"`
	GoalsAllowed30Day            int `json:"goals_allowed_30day"`
	GoalsScoredPeriod1           int `json:"goals_scored_period1"`
	MatchesScored30Day           int `json:"matches_scored_30day"`
	GoalsAllowedPeriod1          int `json:"goals_allowed_period1"`
	MatchesAllowed30Day          int `json:"matches_allowed_30day"`
	MatchesScoredPeriod1         int `json:"matches_scored_period1"`
	MatchesAllowedPeriod1        int `json:"matches_allowed_period1"`
	GoalsScoredPeriod1_30Day     int `json:"goals_scored_period1_30day"`
	GoalsAllowedPeriod1_30Day    int `json:"goals_allowed_period1_30day"`
	MatchesScoredPeriod1_30Day   int `json:"matches_scored_period1_30day"`
	MatchesAllowedPeriod1_30Day  int `json:"matches_allowed_period1_30day"`
}

// 输出模型结构
type TreeNode struct {
	IsLeaf       bool       `json:"isLeaf"`
	Prediction   float64    `json:"prediction,omitempty"`
	FeatureIndex int        `json:"featureIndex,omitempty"`
	Threshold    float64    `json:"threshold,omitempty"`
	Left         *TreeNode  `json:"left,omitempty"`
	Right        *TreeNode  `json:"right,omitempty"`
}

type TrainedModel struct {
	Trees                []*TreeNode `json:"trees"`
	Mean                 []float64   `json:"mean"`
	Std                  []float64   `json:"std"`
	FeatureNames         []string    `json:"featureNames"`
	RecommendedThreshold float64     `json:"recommendedThreshold"`
}

// -------------------- 配置参数 --------------------
const (
	MIN_MATCHES        = 3
	MIN_MATCHES_30DAY  = 1
	NUM_TREES          = 100
	MAX_DEPTH          = 8
	MIN_SAMPLES_SPLIT  = 5
	THRESHOLD_STEP     = 0.02
	MIN_POS_RATIO      = 0.7
)

// -------------------- 辅助函数 --------------------
func safeDiv(a, b int, defaultVal float64) float64 {
	if b > 0 {
		return float64(a) / float64(b)
	}
	return defaultVal
}

// -------------------- 特征提取 (26维) --------------------
func extractFeatures(t1, t2 TeamStats) []float64 {
	t1GoalsP1Avg := safeDiv(t1.GoalsScoredPeriod1, t1.Matches, 0)
	t2GoalsP1Avg := safeDiv(t2.GoalsScoredPeriod1, t2.Matches, 0)
	t1AllowedP1Avg := safeDiv(t1.GoalsAllowedPeriod1, t1.Matches, 0)
	t2AllowedP1Avg := safeDiv(t2.GoalsAllowedPeriod1, t2.Matches, 0)

	t1ScoredRatio := safeDiv(t1.MatchesScoredPeriod1, t1.Matches, 0)
	t2ScoredRatio := safeDiv(t2.MatchesScoredPeriod1, t2.Matches, 0)
	t1AllowedRatio := safeDiv(t1.MatchesAllowedPeriod1, t1.Matches, 0)
	t2AllowedRatio := safeDiv(t2.MatchesAllowedPeriod1, t2.Matches, 0)

	t1GoalsP1_30 := safeDiv(t1.GoalsScoredPeriod1_30Day, t1.Matches30Day, 0)
	t2GoalsP1_30 := safeDiv(t2.GoalsScoredPeriod1_30Day, t2.Matches30Day, 0)
	t1AllowedP1_30 := safeDiv(t1.GoalsAllowedPeriod1_30Day, t1.Matches30Day, 0)
	t2AllowedP1_30 := safeDiv(t2.GoalsAllowedPeriod1_30Day, t2.Matches30Day, 0)

	t1ScoredRatio30 := safeDiv(t1.MatchesScoredPeriod1_30Day, t1.Matches30Day, 0)
	t2ScoredRatio30 := safeDiv(t2.MatchesScoredPeriod1_30Day, t2.Matches30Day, 0)
	t1AllowedRatio30 := safeDiv(t1.MatchesAllowedPeriod1_30Day, t1.Matches30Day, 0)
	t2AllowedRatio30 := safeDiv(t2.MatchesAllowedPeriod1_30Day, t2.Matches30Day, 0)

	attackVsDefense := t1GoalsP1Avg * t2AllowedP1Avg
	defenseVsAttack := t1AllowedP1Avg * t2GoalsP1Avg
	bothAttack := t1GoalsP1Avg + t2GoalsP1Avg
	bothDefense := t1AllowedP1Avg + t2AllowedP1Avg

	t1Trend := t1GoalsP1_30
	if t1GoalsP1Avg > 0 {
		t1Trend /= t1GoalsP1Avg
	} else {
		t1Trend = 1.0
	}
	t2Trend := t2GoalsP1_30
	if t2GoalsP1Avg > 0 {
		t2Trend /= t2GoalsP1Avg
	} else {
		t2Trend = 1.0
	}
	t1DefTrend := t1AllowedP1_30
	if t1AllowedP1Avg > 0 {
		t1DefTrend /= t1AllowedP1Avg
	} else {
		t1DefTrend = 1.0
	}
	t2DefTrend := t2AllowedP1_30
	if t2AllowedP1Avg > 0 {
		t2DefTrend /= t2AllowedP1Avg
	} else {
		t2DefTrend = 1.0
	}

	diffAttack := t1GoalsP1Avg - t2GoalsP1Avg
	diffDefense := t1AllowedP1Avg - t2AllowedP1Avg

	return []float64{
		t1GoalsP1Avg, t2GoalsP1Avg,
		t1AllowedP1Avg, t2AllowedP1Avg,
		t1ScoredRatio, t2ScoredRatio,
		t1AllowedRatio, t2AllowedRatio,
		t1GoalsP1_30, t2GoalsP1_30,
		t1AllowedP1_30, t2AllowedP1_30,
		t1ScoredRatio30, t2ScoredRatio30,
		t1AllowedRatio30, t2AllowedRatio30,
		attackVsDefense, defenseVsAttack,
		bothAttack, bothDefense,
		t1Trend, t2Trend,
		t1DefTrend, t2DefTrend,
		diffAttack, diffDefense,
	}
}

// -------------------- 标准化 --------------------
func computeMeanStd(matrix [][]float64) ([]float64, []float64) {
	if len(matrix) == 0 {
		return nil, nil
	}
	n := len(matrix)
	d := len(matrix[0])
	mean := make([]float64, d)
	std := make([]float64, d)

	for i := 0; i < n; i++ {
		for j := 0; j < d; j++ {
			mean[j] += matrix[i][j]
		}
	}
	for j := 0; j < d; j++ {
		mean[j] /= float64(n)
	}

	for i := 0; i < n; i++ {
		for j := 0; j < d; j++ {
			diff := matrix[i][j] - mean[j]
			std[j] += diff * diff
		}
	}
	for j := 0; j < d; j++ {
		std[j] = math.Sqrt(std[j] / float64(n))
		if std[j] < 1e-8 {
			std[j] = 1.0
		}
	}
	return mean, std
}

// -------------------- 随机森林 --------------------
type DecisionTreeNode struct {
	IsLeaf       bool
	Prediction   float64
	FeatureIndex int
	Threshold    float64
	Left         *DecisionTreeNode
	Right        *DecisionTreeNode
}

type RandomForest struct {
	Trees []*DecisionTreeNode
}

func gini(y []int) float64 {
	if len(y) == 0 {
		return 0
	}
	pos := 0
	for _, v := range y {
		if v == 1 {
			pos++
		}
	}
	p1 := float64(pos) / float64(len(y))
	p0 := 1.0 - p1
	return 1.0 - p1*p1 - p0*p0
}

func getRandomFeatures(numFeatures int) []int {
	n := int(math.Sqrt(float64(numFeatures)))
	indices := make([]int, 0, n)
	used := make(map[int]bool)
	for len(indices) < n {
		idx := rand.Intn(numFeatures)
		if !used[idx] {
			used[idx] = true
			indices = append(indices, idx)
		}
	}
	sort.Ints(indices)
	return indices
}

func bestSplit(X [][]float64, y []int, featureIndices []int, minSamplesSplit int) (bestFeature int, bestThreshold float64, bestGain float64) {
	bestGain = -1.0
	bestFeature = -1
	currentGini := gini(y)

	for _, featIdx := range featureIndices {
		values := make([]float64, len(X))
		for i := range X {
			values[i] = X[i][featIdx]
		}
		uniqueMap := make(map[float64]bool)
		for _, v := range values {
			uniqueMap[v] = true
		}
		uniqueVals := make([]float64, 0, len(uniqueMap))
		for v := range uniqueMap {
			uniqueVals = append(uniqueVals, v)
		}
		sort.Float64s(uniqueVals)
		if len(uniqueVals) <= 1 {
			continue
		}

		for i := 0; i < len(uniqueVals)-1; i++ {
			threshold := (uniqueVals[i] + uniqueVals[i+1]) / 2.0
			leftY := make([]int, 0)
			rightY := make([]int, 0)
			for j := 0; j < len(X); j++ {
				if X[j][featIdx] <= threshold {
					leftY = append(leftY, y[j])
				} else {
					rightY = append(rightY, y[j])
				}
			}
			if len(leftY) < minSamplesSplit || len(rightY) < minSamplesSplit {
				continue
			}
			giniLeft := gini(leftY)
			giniRight := gini(rightY)
			weightedGini := (float64(len(leftY))*giniLeft + float64(len(rightY))*giniRight) / float64(len(y))
			gain := currentGini - weightedGini
			if gain > bestGain {
				bestGain = gain
				bestFeature = featIdx
				bestThreshold = threshold
			}
		}
	}
	return
}

func buildTree(X [][]float64, y []int, depth, maxDepth, minSamplesSplit int) *DecisionTreeNode {
	node := &DecisionTreeNode{}
	if depth >= maxDepth || len(y) < minSamplesSplit || gini(y) == 0 {
		node.IsLeaf = true
		pos := 0
		for _, v := range y {
			if v == 1 {
				pos++
			}
		}
		node.Prediction = float64(pos) / float64(len(y))
		return node
	}

	featureIndices := getRandomFeatures(len(X[0]))
	bestFeature, bestThreshold, bestGain := bestSplit(X, y, featureIndices, minSamplesSplit)

	if bestFeature == -1 || bestGain <= 0 {
		node.IsLeaf = true
		pos := 0
		for _, v := range y {
			if v == 1 {
				pos++
			}
		}
		node.Prediction = float64(pos) / float64(len(y))
		return node
	}

	leftX := make([][]float64, 0)
	leftY := make([]int, 0)
	rightX := make([][]float64, 0)
	rightY := make([]int, 0)

	for i := 0; i < len(X); i++ {
		if X[i][bestFeature] <= bestThreshold {
			leftX = append(leftX, X[i])
			leftY = append(leftY, y[i])
		} else {
			rightX = append(rightX, X[i])
			rightY = append(rightY, y[i])
		}
	}

	node.FeatureIndex = bestFeature
	node.Threshold = bestThreshold
	node.Left = buildTree(leftX, leftY, depth+1, maxDepth, minSamplesSplit)
	node.Right = buildTree(rightX, rightY, depth+1, maxDepth, minSamplesSplit)
	return node
}

func (rf *RandomForest) Fit(X [][]float64, y []int, numTrees, maxDepth, minSamplesSplit int) {
	rf.Trees = make([]*DecisionTreeNode, numTrees)
    var wg sync.WaitGroup
    for t := 0; t < numTrees; t++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            n := len(X)
            sampleX := make([][]float64, n)
            sampleY := make([]int, n)
            // 每个 goroutine 使用独立随机源避免锁竞争
            rng := rand.New(rand.NewSource(time.Now().UnixNano() + int64(idx)))
            for i := 0; i < n; i++ {
                r := rng.Intn(n)
                sampleX[i] = X[r]
                sampleY[i] = y[r]
            }
            rf.Trees[idx] = buildTree(sampleX, sampleY, 0, maxDepth, minSamplesSplit)
            if (idx+1)%20 == 0 {
                fmt.Printf("  已训练 %d 棵树\n", idx+1)
            }
        }(t)
    }
    wg.Wait()
}

func (rf *RandomForest) PredictProba(x []float64) float64 {
	sum := 0.0
	for _, tree := range rf.Trees {
		node := tree
		for !node.IsLeaf {
			if node.Left != nil && node.Right != nil && x[node.FeatureIndex] <= node.Threshold {
				node = node.Left
			} else if node.Right != nil {
				node = node.Right
			} else {
				break
			}
		}
		sum += node.Prediction
	}
	return sum / float64(len(rf.Trees))
}

func (rf *RandomForest) PredictProbas(X [][]float64) []float64 {
	probs := make([]float64, len(X))
	for i, x := range X {
		probs[i] = rf.PredictProba(x)
	}
	return probs
}

// -------------------- 序列化 --------------------
func serializeTree(node *DecisionTreeNode) *TreeNode {
	if node.IsLeaf {
		return &TreeNode{IsLeaf: true, Prediction: node.Prediction}
	}
	return &TreeNode{
		IsLeaf:       false,
		FeatureIndex: node.FeatureIndex,
		Threshold:    node.Threshold,
		Left:         serializeTree(node.Left),
		Right:        serializeTree(node.Right),
	}
}

// -------------------- 主程序 --------------------
func main() {
	rand.Seed(time.Now().UnixNano())

	// 命令行参数
	inputPath := flag.String("input", "input.json", "输入JSON文件路径")
	outputPath := flag.String("output", "model.json", "输出模型文件路径")
	flag.Parse()

	// 读取输入数据
	inputData, err := os.ReadFile(*inputPath)
	if err != nil {
		fmt.Printf("读取 %s 失败: %v\n", *inputPath, err)
		return
	}
	var matches []InputMatch
	if err := json.Unmarshal(inputData, &matches); err != nil {
		fmt.Printf("解析 %s 失败: %v\n", *inputPath, err)
		return
	}
	fmt.Printf("原始比赛数: %d\n", len(matches))

	// 过滤
	filtered := make([]InputMatch, 0)
	for _, m := range matches {
		if m.Team1Info.Matches < MIN_MATCHES || m.Team2Info.Matches < MIN_MATCHES {
			continue
		}
		if m.Team1Info.Matches30Day < MIN_MATCHES_30DAY || m.Team2Info.Matches30Day < MIN_MATCHES_30DAY {
			continue
		}
		filtered = append(filtered, m)
	}
	fmt.Printf("过滤后比赛数: %d (%.2f%%)\n", len(filtered), float64(len(filtered))/float64(len(matches))*100)

	if len(filtered) == 0 {
		fmt.Println("过滤后无数据，退出")
		return
	}

	// 特征提取
	X := make([][]float64, len(filtered))
	y := make([]int, len(filtered))
	for i, m := range filtered {
		X[i] = extractFeatures(m.Team1Info, m.Team2Info)
		y[i] = m.Period1HasGoals
	}

	// 标准化（使用全部数据）
	mean, std := computeMeanStd(X)
	X_norm := make([][]float64, len(X))
	for i, row := range X {
		X_norm[i] = make([]float64, len(row))
		for j, v := range row {
			X_norm[i][j] = (v - mean[j]) / std[j]
		}
	}

	// 训练随机森林（使用全部数据）
	fmt.Println("开始训练随机森林...")
	rf := &RandomForest{}
	rf.Fit(X_norm, y, NUM_TREES, MAX_DEPTH, MIN_SAMPLES_SPLIT)
	fmt.Println("训练完成。")

	// 在完整训练集上寻找最佳阈值（满足正类预测比例≥70%）
	probs := rf.PredictProbas(X_norm)
	bestThreshold := 0.5
	bestAccuracy := 0.0
	for thresh := 0.0; thresh <= 1.0; thresh += THRESHOLD_STEP {
		preds := make([]int, len(probs))
		for i, p := range probs {
			if p >= thresh {
				preds[i] = 1
			} else {
				preds[i] = 0
			}
		}
		posCount := 0
		for _, p := range preds {
			if p == 1 {
				posCount++
			}
		}
		predPosRatio := float64(posCount) / float64(len(preds))
		if predPosRatio < MIN_POS_RATIO {
			continue
		}
		correct := 0
		for i := 0; i < len(y); i++ {
			if preds[i] == y[i] {
				correct++
			}
		}
		acc := float64(correct) / float64(len(y))
		if acc > bestAccuracy {
			bestAccuracy = acc
			bestThreshold = thresh
		}
	}
	fmt.Printf("推荐阈值: %.2f (正类预测比例 ≥ %.0f%%, 准确率: %.2f%%)\n", bestThreshold, MIN_POS_RATIO*100, bestAccuracy*100)

	// 序列化模型
	serializedTrees := make([]*TreeNode, len(rf.Trees))
	for i, tree := range rf.Trees {
		serializedTrees[i] = serializeTree(tree)
	}

	featureNames := []string{
		"t1_goals_p1_avg", "t2_goals_p1_avg",
		"t1_allowed_p1_avg", "t2_allowed_p1_avg",
		"t1_scored_ratio", "t2_scored_ratio",
		"t1_allowed_ratio", "t2_allowed_ratio",
		"t1_goals_p1_30", "t2_goals_p1_30",
		"t1_allowed_p1_30", "t2_allowed_p1_30",
		"t1_scored_ratio_30", "t2_scored_ratio_30",
		"t1_allowed_ratio_30", "t2_allowed_ratio_30",
		"attack_vs_defense", "defense_vs_attack",
		"both_attack", "both_defense",
		"t1_trend", "t2_trend",
		"t1_def_trend", "t2_def_trend",
		"diff_attack", "diff_defense",
	}

	model := TrainedModel{
		Trees:                serializedTrees,
		Mean:                 mean,
		Std:                  std,
		FeatureNames:         featureNames,
		RecommendedThreshold: bestThreshold,
	}

	output, err := json.MarshalIndent(model, "", "  ")
	if err != nil {
		fmt.Println("序列化模型失败:", err)
		return
	}
	if err := os.WriteFile(*outputPath, output, 0644); err != nil {
		fmt.Printf("写入 %s 失败: %v\n", *outputPath, err)
		return
	}
	fmt.Printf("模型已保存至 %s\n", *outputPath)
}
