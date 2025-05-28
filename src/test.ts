import Decimal from 'decimal.js'
import { getOddIdentification, isNullOrUndefined } from './common/helpers'
import { Op, type CreationAttributes } from 'sequelize'
import { Odd, PromotedOdd } from './db'
import { getSetting } from './common/settings'

/**
 * 生成最终推荐盘口数据
 * @param attrs 推荐数据集合
 * @param odds 原始盘口列表
 */
async function generatePromotedOdds(attrs: CreationAttributes<PromotedOdd>[], odds: Odd[]) {
    //读取一下过滤配置
    const settings = await getSetting(
        'corner_enable',
        'corner_period1_enable',
        'filter_rate',
        'period1_enable',
        'special_enable',
        'adjust_condition',
    )

    //先对盘口和推荐结果进行一下组合
    let list = attrs.map((attr) => ({
        attr,
        odd: odds.find((t) => t.id === attr.odd_id!)!,
    }))

    //然后对列表做一下排序，ready时间更大的盘排在前面
    list.sort((t1, t2) => t1.odd.ready_at!.valueOf() - t2.odd.ready_at!.valueOf())

    //做第一步筛选，如果盘口条件不满足的就直接过滤掉
    for (const item of list) {
        if (item.attr.skip) continue

        //特殊规则判断
        if (findRule(settings.special_enable, item.odd)) {
            continue
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
    }

    const output: typeof list = []

    const hasSameOdd = (item: (typeof list)[number]) => {
        //看最终输出列表中有没有存在相同类型的盘
        let exists1 = output.some(
            (t) =>
                t.attr.variety === item.attr.variety &&
                t.attr.period === item.attr.period &&
                getOddIdentification(t.attr.type) === getOddIdentification(item.attr.type),
        )
        if (exists1) return true

        //再判断有没有上下半场相反的数据
        return output.some((t) => {
            return (
                t.attr.variety === item.attr.variety &&
                t.attr.period !== item.attr.period &&
                getOddIdentification(t.attr.type) === getOddIdentification(item.attr.type) &&
                t.attr.type !== item.attr.type
            )
        })
    }

    //进行整理，没有变盘的数据最优先
    for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i]
        if (!isNullOrUndefined(item.odd.crown_condition2)) {
            if (Decimal(item.odd.crown_condition2).eq(item.attr.condition)) {
                if (!item.attr.skip) {
                    item.attr.skip = hasSameOdd(item) ? 'same_type' : ''
                }
                output.push(item)
                list.splice(i, 1)
            }
        }
    }

    //然后是已经变盘的数据，按序插入，如果有相同的盘就pass掉
    list.reverse()
    for (const item of list) {
        if (!item.attr.skip) {
            item.attr.skip = hasSameOdd(item) ? 'same_type' : ''
        }
        output.push(item)
    }

    //变盘逻辑
    for (const item of output) {
        const found = findRule<AdjustConditionRule>(settings.adjust_condition, item.attr)
        if (found) {
            //有变盘规则
            item.attr.condition = Decimal(item.attr.condition).add(found.adjust).toString()
        }
    }

    console.log('output', output)
    // console.log('list', list)
}

async function main() {
    const attrs: CreationAttributes<PromotedOdd>[] = [
        {
            odd_id: 1596,
            variety: 'corner',
            period: 'regularTime',
            type: 'under',
            condition: '10.50',
            match_id: 6137,
            back: 1,
        },
    ]

    const odds = await Odd.findAll({
        where: {
            match_id: 6137,
        },
    })

    await generatePromotedOdds(attrs, odds)
}

function findRule<T extends SpecialPromoteRule>(rules: T[], odd: OddInfo): T | undefined {
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
            let pass = false
            switch (rule.condition_symbol) {
                case '>':
                    pass = Decimal(odd.condition).gt(rule.condition)
                    break
                case '>=':
                    pass = Decimal(odd.condition).gte(rule.condition)
                    break
                case '<':
                    pass = Decimal(odd.condition).lt(rule.condition)
                    break
                case '<=':
                    pass = Decimal(odd.condition).lte(rule.condition)
                    break
                case '=':
                    pass = Decimal(odd.condition).eq(rule.condition)
                    break
            }
            console.log('pass', pass)
            return pass ? rule : undefined
        }

        return rule
    }
}

async function main2() {
    //读取一下过滤配置
    const settings = await getSetting(
        'corner_enable',
        'corner_period1_enable',
        'filter_rate',
        'period1_enable',
        'special_enable',
        'adjust_condition',
    )

    const odd = await Odd.findOne({
        where: {
            id: 1596,
        },
    })

    const found = findRule(settings.special_enable, odd!)
    console.log(found)
}

main2().finally(() => process.exit())
