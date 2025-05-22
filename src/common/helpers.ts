import Decimal from 'decimal.js'
import { RateLimiter } from './rate-limiter'
import { PromotedOdd } from '@/db'

/**
 * 返回一个等待指定时间的Promise
 * @param timeout 要等待的时间
 * @returns
 */
export function delay(timeout: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, timeout))
}

/**
 * 执行循环的任务
 * @param interval 任务执行间隔
 * @param task 待执行的任务
 */
export async function runLoop(interval: number, task: () => void | Promise<void>) {
    const limiter = new RateLimiter(interval)
    while (true) {
        await limiter.next()
        try {
            await task()
        } catch (err) {
            console.error(err)
        }
    }
}

export function isNullOrUndefined(value: any): value is null | undefined {
    if (typeof value === 'undefined') return true
    if (value === null) return true
    return false
}

export function isEmpty(value: any): value is null | undefined {
    if (isNullOrUndefined(value)) return true
    if (typeof value === 'string') {
        return value === ''
    }
    return false
}

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
            if (
                isNullOrUndefined(match.corner1_period1) ||
                isNullOrUndefined(match.corner2_period1)
            ) {
                return
            }
            score1 = match.corner1_period1
            score2 = match.corner2_period1
        } else {
            if (isNullOrUndefined(match.corner1) || isNullOrUndefined(match.corner2)) {
                return
            }
            score1 = match.corner1
            score2 = match.corner2
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

/**
 * 根据原始盘口和是否反推，计算推荐盘口的数据
 */
export function getPromotedOddInfo(
    odd: Pick<OddInfo, 'condition' | 'type'>,
    back: boolean | number,
): Pick<OddInfo, 'condition' | 'type'> {
    if (!back) {
        //正推直接返回数据
        return odd
    }
    switch (odd.type) {
        case 'ah1':
            //让球盘的反推需要改变盘口方向和让球值
            return {
                type: 'ah2',
                condition: Decimal(0).sub(odd.condition).toString(),
            }
        case 'ah2':
            //让球盘的反推需要改变盘口方向和让球值
            return {
                type: 'ah1',
                condition: Decimal(0).sub(odd.condition).toString(),
            }
        case 'over':
            //大小球的反推只需要改变投注方向
            return {
                type: 'under',
                condition: odd.condition,
            }
        case 'under':
            return {
                type: 'over',
                condition: odd.condition,
            }
    }

    return odd
}

/**
 * 根据原始盘口和系统配置，计算推荐盘口的数据
 * @param odd
 * @param settings
 */
export function getPromotedOddInfoBySetting(
    odd: OddInfo,
    settings: Record<string, any>,
): Pick<PromotedOdd, 'condition' | 'type' | 'back'> {
    //先根据系统配置计算到底是正推还是反推
    const back = (() => {
        //特殊正反推规则
        if (Array.isArray(settings.special_reverse)) {
            const found = settings.special_reverse.find((rule) => {
                if (rule.period !== odd.period) return false
                if (rule.variety !== odd.variety) return false
                if (rule.type !== odd.type) return false
                switch (rule.condition_symbol) {
                    case '>':
                        return Decimal(odd.condition).gt(rule.condition)
                    case '>=':
                        return Decimal(odd.condition).gte(rule.condition)
                    case '<':
                        return Decimal(odd.condition).lt(rule.condition)
                    case '<=':
                        return Decimal(odd.condition).lte(rule.condition)
                    default:
                        return Decimal(odd.condition).eq(rule.condition)
                }
            })

            if (found) return found.back ? 1 : 0
        }

        //角球正反推规则
        if (odd.variety === 'corner') {
            return (settings.corner_reverse ?? true) ? 1 : 0
        }

        //全局正反推规则
        return (settings.promote_reverse ?? true) ? 1 : 0
    })()

    //再根据正反推返回实际推荐的方向
    return {
        ...getPromotedOddInfo(odd, back),
        back,
    }
}

/**
 * 获取盘口标识（用于寻找相同类型的盘口）
 * @param type
 * @returns
 */
export function getOddIdentification(type: OddType) {
    switch (type) {
        case 'ah1':
        case 'ah2':
        case 'draw':
            return 'ah'
        case 'over':
        case 'under':
            return 'goal'
        default:
            return ''
    }
}
