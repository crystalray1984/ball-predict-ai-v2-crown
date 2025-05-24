import Decimal from 'decimal.js'
import { isNullOrUndefined } from './common/helpers'

const special_enable: SpecialPromoteRule[] = [
    {
        id: '1',
        period: null,
        condition: null,
        variety: 'corner',
        type: 'over',
        condition_symbol: null,
        back: false,
    },
    { id: 'IZshclMf6ciyaZnIIprUG', condition: '0', variety: 'corner', type: 'under' },
] as any

const item = {
    attr: {
        variety: 'corner',
        period: 'period1',
        type: 'over',
        condition: '5',
        skip: '',
    },
}

const settings = {
    corner_period1_enable: false,
    corner_enable: false,
    period1_enable: true,
}
;(function () {
    if (special_enable && Array.isArray(special_enable)) {
        //如果盘口满足特殊规则，则不过滤
        const found = special_enable.some((rule) => {
            if (!isNullOrUndefined(rule.variety) && rule.variety !== item.attr.variety) return false
            if (!isNullOrUndefined(rule.period) && rule.period !== item.attr.period) return false
            if (!isNullOrUndefined(rule.type) && rule.type !== item.attr.type) return false
            if (!isNullOrUndefined(rule.condition) && !isNullOrUndefined(rule.condition_symbol)) {
                switch (rule.condition_symbol) {
                    case '>':
                        return Decimal(item.attr.condition).gt(rule.condition)
                    case '>=':
                        return Decimal(item.attr.condition).gte(rule.condition)
                    case '<':
                        return Decimal(item.attr.condition).lt(rule.condition)
                    case '<=':
                        return Decimal(item.attr.condition).lte(rule.condition)
                    case '=':
                        return Decimal(item.attr.condition).eq(rule.condition)
                }
            }
            return true
        })

        if (found) {
            console.log('found')
            return
        }
    }

    if (item.attr.variety === 'corner' && item.attr.period === 'period1') {
        if (!settings.corner_period1_enable) {
            item.attr.skip = 'setting'
        }
    }
    if (item.attr.variety === 'corner') {
        if (!settings.corner_enable) {
            item.attr.skip = 'setting'
        }
    }
    if (item.attr.period === 'period1') {
        if (!settings.period1_enable) {
            item.attr.skip = 'setting'
        }
    }
})()

console.log(item)
