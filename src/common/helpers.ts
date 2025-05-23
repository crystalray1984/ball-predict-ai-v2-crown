import Decimal from 'decimal.js'
import { RateLimiter } from './rate-limiter'
import { PromotedOdd, Titan007Odd } from '@/db'

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
        return {
            condition: odd.condition,
            type: odd.type,
        }
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

    return {
        condition: odd.condition,
        type: odd.type,
    }
}

/**
 * 判断是否应该使用球探网的盘口趋势来确定推荐方向
 */
function isUseTitan007Odd(odd: OddInfo, titan007_odd: Titan007Odd): number | undefined {
    let start: string | undefined | null = null
    let end: string | undefined | null = null

    if (odd.variety === 'goal') {
        //进球判断
        if (odd.period === 'period1') {
            //半场判断
            switch (odd.type) {
                case 'ah1':
                case 'ah2':
                    start = titan007_odd.ah_period1_start
                    end = titan007_odd.ah_period1_end
                    break
                case 'over':
                case 'under':
                    start = titan007_odd.goal_period1_start
                    end = titan007_odd.goal_period1_end
                    break
            }
        } else {
            //全场判断
            switch (odd.type) {
                case 'ah1':
                case 'ah2':
                    start = titan007_odd.ah_start
                    end = titan007_odd.ah_end
                    break
                case 'over':
                case 'under':
                    start = titan007_odd.goal_start
                    end = titan007_odd.goal_end
                    break
            }
        }
    } else if (odd.variety === 'corner') {
        //角球判断
        switch (odd.type) {
            case 'ah1':
            case 'ah2':
                start = titan007_odd.corner_ah_start
                end = titan007_odd.corner_ah_end
                break
            case 'over':
            case 'under':
                start = titan007_odd.corner_goal_start
                end = titan007_odd.corner_goal_end
                break
        }
    }

    if (isNullOrUndefined(start) || isNullOrUndefined(end)) return
    const delta = Decimal(end).comparedTo(start)
    if (delta === 0) {
        //盘口相同
        return
    } else if (delta > 0) {
        //盘口变大
        switch (odd.type) {
            case 'ah1':
            case 'ah2':
                //让球盘，盘口变大表示倾向于客队
                return odd.type !== 'ah2' ? 1 : 0
            case 'over':
            case 'under':
                //大小盘，盘口变大表示倾向于大球
                return odd.type !== 'over' ? 1 : 0
        }
    } else {
        //盘口变小
        switch (odd.type) {
            case 'ah1':
            case 'ah2':
                //让球盘，盘口变小表示倾向于主队
                return odd.type !== 'ah1' ? 1 : 0
            case 'over':
            case 'under':
                //大小盘，盘口变大表示倾向于小球
                return odd.type !== 'under' ? 1 : 0
        }
    }
}

/**
 * 根据原始盘口和系统配置，计算推荐盘口的数据
 * @param odd
 * @param settings
 */
export async function getPromotedOddInfoBySetting(
    match_id: number,
    odd: OddInfo,
    settings: Record<string, any>,
): Promise<Pick<PromotedOdd, 'condition' | 'type' | 'back' | 'final_rule'>> {
    //先看看在不在推荐方向的特殊规则里
    let result = (() => {
        //特殊正反推规则
        const special_reverse = settings.special_reverse as SpecialReverseRule[]
        if (special_reverse && Array.isArray(special_reverse)) {
            const found = special_reverse.find((rule) => {
                if (!isNullOrUndefined(rule.period) && odd.period !== rule.period) return false
                if (!isNullOrUndefined(rule.variety) && rule.variety !== odd.variety) return false
                if (!isNullOrUndefined(rule.type) && rule.type !== odd.type) return false
                if (
                    !isNullOrUndefined(rule.condition) &&
                    !isNullOrUndefined(rule.condition_symbol)
                ) {
                    switch (rule.condition_symbol) {
                        case '>':
                            return Decimal(odd.condition).gt(rule.condition)
                        case '>=':
                            return Decimal(odd.condition).gte(rule.condition)
                        case '<':
                            return Decimal(odd.condition).lt(rule.condition)
                        case '<=':
                            return Decimal(odd.condition).lte(rule.condition)
                        case '=':
                            return Decimal(odd.condition).eq(rule.condition)
                    }
                }
                return true
            })

            if (found)
                return {
                    back: found.back ? 1 : 0,
                    final_rule: 'special',
                }
        }
    })()

    //如果特殊规则不满足，再根据是否开启了球探网趋势，通过球探网趋势判断正反推
    if (!result && settings.titan007_reverse) {
        const titan007_odd = await Titan007Odd.findOne({
            where: {
                match_id,
            },
        })
        if (titan007_odd) {
            let back = isUseTitan007Odd(odd, titan007_odd)
            if (typeof back === 'number') {
                result = { back, final_rule: 'titan007' }
            }
        }
    }

    //如果还是没有结果，就根据常规配置来判断方向
    if (!result) {
        //角球正反推规则
        if (odd.variety === 'corner' && !isNullOrUndefined(settings.corner_reverse)) {
            result = { back: settings.corner_reverse ? 1 : 0, final_rule: '' }
        } else {
            result = { back: settings.promote_reverse ? 1 : 0, final_rule: '' }
        }
    }

    //再根据正反推返回实际推荐的方向
    return {
        ...getPromotedOddInfo(odd, result.back),
        ...result,
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

/**
 * 交换对象里的2个字段的值
 * @param object
 * @param key1
 * @param key2
 */
export function swapField<T extends object>(object: T, key1: keyof T, key2: keyof T): void {
    const temp = object[key1]
    object[key1] = object[key2]
    object[key2] = temp
}
