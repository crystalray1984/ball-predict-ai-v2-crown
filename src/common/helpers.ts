import { CONFIG } from '@/config'
import { redis, Titan007Odd } from '@/db'
import dayjs, { ConfigType } from 'dayjs'
import Decimal from 'decimal.js'
import { machineIdSync } from 'node-machine-id'
import { stat } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { RateLimiter } from './rate-limiter'

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
 * 进行比分对比
 * @param score1
 * @param score2
 */
export function compareScore(
    score1: Decimal.Value,
    score2: Decimal.Value,
): '-0.5' | '-1' | '0' | '0.5' | '1' {
    //给作为比对的结果加上盘口
    const delta = Decimal(score1).sub(score2)
    if (delta.eq('0')) return '0'
    if (delta.gte('0.5')) {
        return '1'
    }
    if (delta.gte('0.25')) {
        return '0.5'
    }
    if (delta.lte('-0.5')) {
        return '-1'
    }
    if (delta.lte('-0.25')) {
        return '-0.5'
    }
    return '0'
}

/**
 * 计算盘口的赛果
 */
export function getOddResult(
    odd: OddInfo & { value?: string | number | null },
    match: Titan007.MatchScore,
) {
    let score1: number
    let score2: number
    let result: number
    let score: string
    let result_value: string
    let result_profit: string | number | null = null

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
        score = `${score1}:${score2}`
        result_value = compareScore(Decimal(score1).add(odd.condition), score2)
    } else if (odd.type === 'ah2') {
        //让球，买客队
        score = `${score1}:${score2}`
        result_value = compareScore(Decimal(score2).add(odd.condition), score1)
    } else if (odd.type === 'over') {
        //大球
        score = `${score1 + score2}`
        result_value = compareScore(score1 + score2, odd.condition)
    } else if (odd.type === 'under') {
        //小球
        score = `${score1 + score2}`
        result_value = compareScore(odd.condition, score1 + score2)
    } else if (odd.type === 'draw') {
        score = `${score1}:${score2}`
        result_value = score1 === score2 ? '1' : '-1'
    } else if (odd.type === 'win1') {
        score = `${score1}:${score2}`
        result_value = score1 > score2 ? '1' : '-1'
    } else if (odd.type === 'win2') {
        score = `${score1}:${score2}`
        result_value = score1 < score2 ? '1' : '-1'
    } else if (odd.type === 'btts_yes') {
        //双方有进球
        score = `${score1}:${score2}`
        result_value = score1 > 0 && score2 > 0 ? '1' : '-1'
    } else if (odd.type === 'btts_no') {
        //双方有进球
        score = `${score1}:${score2}`
        result_value = score1 == 0 && score2 == 0 ? '1' : '-1'
    } else {
        return
    }

    //胜负计算
    switch (result_value) {
        case '0.5':
        case '1':
            result = 1
            break
        case '-0.5':
        case '-1':
            result = -1
            break
        default:
            result = 0
            break
    }

    //收益计算
    if (isDecimal(odd.value)) {
        switch (result_value) {
            case '0.5':
            case '1':
                result_profit = Decimal(odd.value).sub(1).mul(result_value).toString()
                break
            default:
                result_profit = result_value
                break
        }
    }

    return {
        result,
        score,
        score1,
        score2,
        result_value,
        result_profit,
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
        case 'win1':
            return {
                type: 'win2',
                condition: odd.condition,
            }
        case 'win2':
            return {
                type: 'win1',
                condition: odd.condition,
            }
        case 'btts_yes':
            return {
                type: 'btts_no',
                condition: odd.condition,
            }
        case 'btts_no':
            return {
                type: 'btts_yes',
                condition: odd.condition,
            }
    }

    return {
        condition: odd.condition,
        type: odd.type,
    }
}

/**
 * 获取盘口标识（用于寻找相同类型的盘口）
 * @param type
 * @returns
 */
export function getOddIdentification(type: OddType): OddIdentification {
    switch (type) {
        case 'ah1':
        case 'ah2':
            return 'ah'
        case 'over':
        case 'under':
            return 'sum'
        case 'win1':
        case 'win2':
        case 'draw':
            return 'win'
        case 'btts_yes':
        case 'btts_no':
            return 'btts'
    }

    return undefined as any
}

/**
 * 获取同类盘口的标识列表
 * @param type 当前盘口标识
 */
export function getSameOddTypes(type: OddType): OddType[] {
    switch (getOddIdentification(type)) {
        case 'ah':
            return ['ah1', 'ah2']
        case 'sum':
            return ['over', 'under']
        case 'win':
            return ['win1', 'win2', 'draw']
        case 'btts':
            return ['btts_yes', 'btts_no']
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

export function isDecimal(value: any): value is string | number {
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

/**
 * 判断文件是否存在
 * @param filePath
 * @returns
 */
export function isFileExists(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
        stat(filePath, (err, stats) => {
            if (err) {
                resolve(false)
            } else {
                resolve(stats.isFile())
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

/**
 * @param name
 * @param data
 */
export async function debugFileLog(name: string, data: any) {
    const time = dayjs().format('YYYYMMDDHHmmssSSS')
    const logFile = resolve(__dirname, `../../runtime/${name}_${time}.log`)
    const content = (() => {
        if (typeof data === 'string') {
            return data
        }
        if (data instanceof Error) {
            return [data.name, data.message, data.stack].join('\n')
        }
        return JSON.stringify(data, null, 4)
    })()

    await writeFile(logFile, content)
}

/**
 * 获取周标记
 * @param input
 */
export function getWeekDay(input?: ConfigType): number {
    let day = dayjs(input).startOf('day')
    if (day.day() === 0) {
        day = day.subtract(6, 'day')
    } else if (day.day() > 1) {
        day = day.subtract(day.day() - 1, 'day')
    }
    return parseInt(day.format('YYYYMMDD'))
}

/**
 * 获取机器id
 * @returns
 */
export function getMachineId() {
    return CONFIG.machine_id || machineIdSync()
}

/**
 * 清理频道数据缓存
 * @param channels
 */
export async function clearChannelCache(...channels: string[]) {
    if (channels.length === 0) return
    await redis.del(...channels.map((channel) => `summary:${channel}`))
}
