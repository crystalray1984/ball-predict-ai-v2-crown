const fs = require('fs')
const path = require('path')

// ================== 配置区 ==================
const INPUT_FILE = '筛选后的比赛数据.csv' // 输入文件名
const OUTPUT_FILE = '筛选后的比赛数据_带系数.csv' // 输出文件名

// 过滤条件：主队近期比赛数 + 客队近期比赛数 >= MIN_TOTAL_GAMES 的行才会被计算系数
// 设为 0 表示不进行过滤，对所有行计算
const MIN_TOTAL_GAMES = 2
// ============================================

/**
 * 解析 CSV 行（简易版，假设数据中不包含逗号、引号等复杂情况）
 */
function parseCSVLine(line) {
    return line.split(',').map((cell) => cell.trim())
}

/**
 * 将数组转换为 CSV 行
 */
function toCSVLine(arr) {
    return arr
        .map((cell) => {
            // 如果内容包含逗号或换行，用引号包裹（此处简单处理，原数据无此情况）
            return String(cell)
        })
        .join(',')
}

/**
 * 计算上半场进球系数
 */
function calculateCoefficient(row) {
    // 主队
    const hRecent = Number(row['主队近期比赛数']) || 0
    const h30d = Number(row['主队30天内比赛数']) || 0
    const hGames = hRecent + h30d
    let hAvgScored = 0,
        hAvgConceded = 0
    if (hGames > 0) {
        const hScored =
            (Number(row['主队近期上半场总得分']) || 0) +
            (Number(row['主队30天内上半场总得分']) || 0)
        const hConceded =
            (Number(row['主队近期上半场总失分']) || 0) +
            (Number(row['主队30天内上半场总失分']) || 0)
        hAvgScored = hScored / hGames
        hAvgConceded = hConceded / hGames
    }

    // 客队
    const aRecent = Number(row['客队近期比赛数']) || 0
    const a30d = Number(row['客队30天内比赛数']) || 0
    const aGames = aRecent + a30d
    let aAvgScored = 0,
        aAvgConceded = 0
    if (aGames > 0) {
        const aScored =
            (Number(row['客队近期上半场总得分']) || 0) +
            (Number(row['客队30天内上半场总得分']) || 0)
        const aConceded =
            (Number(row['客队近期上半场总失分']) || 0) +
            (Number(row['客队30天内上半场总失分']) || 0)
        aAvgScored = aScored / aGames
        aAvgConceded = aConceded / aGames
    }

    // 综合系数：进攻权重1.2，防守漏洞权重0.8
    return (hAvgScored + aAvgScored) * 1.2 + (hAvgConceded + aAvgConceded) * 0.8
}

// 主流程
function main() {
    console.log(`📂 读取文件: ${INPUT_FILE}`)
    const content = fs.readFileSync(INPUT_FILE, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim() !== '')

    if (lines.length < 2) {
        console.error('❌ CSV 文件至少需要标题行和一行数据')
        return
    }

    // 解析标题行
    const headers = parseCSVLine(lines[0])
    console.log(`📋 字段数量: ${headers.length}`)

    // 解析数据行
    const dataRows = lines.slice(1).map((line) => parseCSVLine(line))

    // 去重（基于“比赛id”列）
    const idIndex = headers.indexOf('比赛id')
    if (idIndex === -1) {
        console.error('❌ 未找到“比赛id”列')
        return
    }

    const seenIds = new Set()
    const uniqueRows = []
    const duplicateCount = dataRows.length - uniqueRows.length // 稍后计算

    for (const row of dataRows) {
        const id = row[idIndex]
        if (!seenIds.has(id)) {
            seenIds.add(id)
            // 转换为对象方便计算
            const obj = {}
            headers.forEach((h, i) => {
                obj[h] = row[i]
            })
            uniqueRows.push(obj)
        }
    }

    console.log(`🔍 原始数据行数: ${dataRows.length}`)
    console.log(
        `✅ 去重后行数: ${uniqueRows.length} (去除重复 ${dataRows.length - uniqueRows.length} 行)`,
    )

    // 计算系数并添加过滤标记
    let calculatedCount = 0
    let filteredOutCount = 0
    const outputRows = []

    for (const row of uniqueRows) {
        // 计算总比赛场次用于过滤
        const totalGames =
            (Number(row['主队近期比赛数']) || 0) + (Number(row['客队近期比赛数']) || 0)
        const meetFilter = totalGames >= MIN_TOTAL_GAMES

        let coefficient = ''
        if (meetFilter) {
            coefficient = calculateCoefficient(row).toFixed(6)
            calculatedCount++
        } else {
            coefficient = '' // 不符合过滤条件的留空
            filteredOutCount++
        }

        // 构建输出行（按原始顺序 + 新增列）
        const rowArray = headers.map((h) => row[h] || '')
        rowArray.push(coefficient)
        outputRows.push(rowArray)
    }

    // 新标题：原标题 + "上半场进球系数"
    const newHeaders = [...headers, '上半场进球系数']

    // 写入文件
    const outputLines = [toCSVLine(newHeaders), ...outputRows.map(toCSVLine)]
    fs.writeFileSync(OUTPUT_FILE, outputLines.join('\n'), 'utf-8')

    console.log('\n===== 处理完成 =====')
    console.log(`📊 符合过滤条件 (总场次 >= ${MIN_TOTAL_GAMES}) 的行数: ${calculatedCount}`)
    console.log(`⏭️  被过滤掉的行数: ${filteredOutCount}`)
    console.log(`💾 输出文件: ${OUTPUT_FILE}`)
    console.log('\n💡 提示：您可以在输出 CSV 中根据“上半场进球系数”列自由调整阈值进行预测验证。')
}

main()
