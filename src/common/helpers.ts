import { PromotedOdd, Titan007Odd } from '@/db'
import Decimal from 'decimal.js'
import { RateLimiter } from './rate-limiter'
import { stat } from 'node:fs'
import { mkdir } from 'node:fs/promises'

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
    //输出结果
    const output = (
        back: number | boolean,
        final_rule: PromotedOdd['final_rule'],
    ): Pick<PromotedOdd, 'condition' | 'type' | 'back' | 'final_rule'> => {
        return {
            ...getPromotedOddInfo(odd, back),
            back: back ? 1 : 0,
            final_rule,
        }
    }

    //先看有没有特殊的正反推规则
    const specialRule = findRule<SpecialReverseRule>(settings.special_reverse, odd)
    if (specialRule) {
        return output(specialRule.back, 'special')
    }

    //再看能否通过球探网做趋势判断
    if (settings.titan007_reverse) {
        const titan007_odd = await Titan007Odd.findOne({
            where: {
                match_id,
            },
        })
        if (titan007_odd) {
            let back = isUseTitan007Odd(odd, titan007_odd)
            if (typeof back === 'number') {
                return output(back, 'titan007')
            }
        }
    }

    //看看是否为角球，走角球正反推判断
    if (odd.variety === 'corner' && !isNullOrUndefined(settings.corner_reverse)) {
        return output(!!settings.corner_reverse, 'corner')
    }

    //走全局的正反推判断
    return output(!!settings.promote_reverse, '')
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
 * 获取同类盘口的标识列表
 * @param type 当前盘口标识
 */
export function getSameOddTypes(type: OddType): OddType[] {
    switch (type) {
        case 'ah1':
        case 'ah2':
        case 'draw':
            return ['ah1', 'ah2', 'draw']
        case 'over':
        case 'under':
            return ['over', 'under']
        default:
            return []
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

/**
 * 寻找满足条件的盘口规则
 * @param rules
 * @param odd
 * @returns
 */
export function findRule<T extends SpecialPromoteRule>(rules: T[], odd: OddInfo): T | undefined {
    if (!rules || !Array.isArray(rules) || rules.length === 0) return
    for (const rule of rules) {
        if (!isNullOrUndefined(rule.variety) && rule.variety !== odd.variety) {
            continue
        }
        if (!isNullOrUndefined(rule.period) && rule.period !== odd.period) {
            continue
        }
        if (!isNullOrUndefined(rule.type) && rule.type !== odd.type) {
            continue
        }
        if (!isNullOrUndefined(rule.condition) && !isNullOrUndefined(rule.condition_symbol)) {
            if (!compareValue(odd.condition, rule.condition, rule.condition_symbol)) {
                continue
            }
        }

        return rule
    }
}

/**
 * 寻找满足条件的带水位判断的盘口规则
 */
export function findRuleWithValue<
    T extends SpecialPromoteRule & {
        value_symbol?: SpecialPromoteRule['condition_symbol']
        value: string
    },
>(rules: T[], odd: OddInfo & { value: string }): T | undefined {
    if (!rules || !Array.isArray(rules) || rules.length === 0) return
    for (const rule of rules) {
        if (!isNullOrUndefined(rule.variety) && rule.variety !== odd.variety) {
            continue
        }
        if (!isNullOrUndefined(rule.period) && rule.period !== odd.period) {
            continue
        }
        if (!isNullOrUndefined(rule.type) && rule.type !== odd.type) {
            continue
        }
        if (!isNullOrUndefined(rule.condition) && !isNullOrUndefined(rule.condition_symbol)) {
            if (!compareValue(odd.condition, rule.condition, rule.condition_symbol)) {
                continue
            }
        }
        if (!isNullOrUndefined(rule.value) && !isNullOrUndefined(rule.value_symbol)) {
            if (!compareValue(odd.value, rule.value, rule.value_symbol)) {
                continue
            }
        }

        return rule
    }
}

/**
 * 根据判断符号比较两个值是否满足
 * @param value1
 * @param value2
 * @param symbol
 */
export function compareValue(
    value1: string | number,
    value2: string | number,
    symbol: '>=' | '>' | '<=' | '<' | '=',
): boolean {
    switch (symbol) {
        case '>':
            return Decimal(value1).gt(value2)
        case '>=':
            return Decimal(value1).gte(value2)
        case '<':
            return Decimal(value1).lt(value2)
        case '<=':
            return Decimal(value1).lte(value2)
        case '=':
            return Decimal(value1).eq(value2)
        default:
            return true
    }
}

export function isDecimal(value: string | number) {
    try {
        Decimal(value)
        return true
    } catch {
        return false
    }
}

/**
 * 判断目录是否存在
 * @param dirPath
 * @returns
 */
export function isDirExists(dirPath: string): Promise<boolean> {
    return new Promise((resolve) => {
        stat(dirPath, (err, stats) => {
            if (err) {
                resolve(false)
            } else {
                resolve(stats.isDirectory())
            }
        })
    })
}

export async function prepareDir(dirPath: string): Promise<void> {
    if (await isDirExists(dirPath)) return
    await mkdir(dirPath, { recursive: true })
}

export function getNumberWithSymbol(input: Decimal.Value) {
    const value = Decimal(input)
    if (value.gt(0)) {
        return '+' + value.toNumber()
    } else {
        return value.toNumber().toString()
    }
}
