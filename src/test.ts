import Decimal from 'decimal.js'

/**
 * 计算盘口结果
 */
export function calcResult(
    condition: string,
    score1: number | string,
    score2: number | string,
): number {
    condition = Decimal(condition).toString()
    let parts: string[]
    if (condition.endsWith('.25') || condition.endsWith('.75')) {
        parts = [Decimal(condition).sub('.25').toString(), Decimal(condition).add('.25').toString()]
    } else {
        parts = [condition]
    }

    const result = parts.reduce<number>((prev, part) => {
        return prev + Decimal(score1).add(part).comparedTo(score2)
    }, 0)

    return result > 0 ? 1 : result < 0 ? -1 : 0
}

/**
 * 计算盘口的赛果
 */
export function getOddResult(odd: OddInfo, match: Titan007.MatchScore) {
    let score1: number
    let score2: number
    let result: number
    let score: string

    //数据完整性检测
    if (odd.variety === 'corner') {
        if (odd.period === 'period1') {
            score1 = match.corner1_period1!
            score2 = match.corner2_period1!
        } else {
            score1 = match.corner1!
            score2 = match.corner2!
        }
    } else if (odd.variety === 'goal') {
        if (odd.period === 'period1') {
            score1 = match.score1_period1
            score2 = match.score2_period1
        } else {
            score1 = match.score1
            score2 = match.score2
        }
    } else {
        return
    }

    //确认投注类型
    if (odd.type === 'ah1') {
        //让球，买主队
        result = calcResult(odd.condition, score1, score2)
        score = `${score1}:${score2}`
    } else if (odd.type === 'ah2') {
        //让球，买客队
        result = calcResult(odd.condition, score2, score1)
        score = `${score1}:${score2}`
    } else if (odd.type === 'over') {
        //大球
        result = calcResult(Decimal(0).sub(odd.condition).toString(), score1 + score2, 0)
        score = `${score1 + score2}`
    } else if (odd.type === 'under') {
        //小球
        result = 0 - calcResult(Decimal(0).sub(odd.condition).toString(), score1 + score2, 0)
        score = `${score1 + score2}`
    } else if (odd.type === 'draw') {
        result = score1 === score2 ? 1 : -1
        score = `${score1}:${score2}`
    } else {
        return
    }

    return {
        result,
        score,
        score1,
        score2,
    }
}

for (let i = 2; i <= 4; i++) {
    let condition = '2'
    for (let j = 0; j < 5; j++) {
        const info1: OddInfo = {
            period: 'regularTime',
            variety: 'goal',
            type: 'under',
            condition,
        }

        console.log('result', condition, getOddResult(info1, { score1: 0, score2: i } as any))

        condition = Decimal(condition).add('0.25').toString()
    }
}
