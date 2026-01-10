import { RockballOdd, VPromoted } from '@/db'
import Decimal from 'decimal.js'
import { InferAttributes, Op } from 'sequelize'
import { isDecimal } from './helpers'
import { getSetting } from './settings'

/**
 * 通过其他推荐数据作为滚球输入的数据
 */
interface RockballInput
    extends Pick<
        InferAttributes<VPromoted>,
        | 'id'
        | 'channel'
        | 'match_id'
        | 'variety'
        | 'period'
        | 'type'
        | 'condition'
        | 'value'
        | 'crown_match_id'
    > {}

/**
 * 根据已经推荐出来的盘口信息生成滚球盘
 */
export async function createRockballOddFromPromoted(input: RockballInput | number) {
    const config = await getSetting<RockballConfig[]>('rockball_config')
    if (!config || !Array.isArray(config) || config.length === 0) {
        return
    }

    if (typeof input === 'number') {
        const promoted = await VPromoted.findOne({
            where: {
                id: input,
            },
        })
        if (!promoted) return
        input = promoted
    }

    let matchedRule: RockballConfig | undefined = undefined

    for (const rule of config) {
        //基础盘口判定
        if (rule.variety !== input.variety) continue
        if (rule.period !== input.period) continue
        if (rule.type !== input.type) continue

        if (!isDecimal(rule.condition2)) {
            //规则盘口是个固定值
            if (!Decimal(rule.condition).eq(input.condition)) continue
        } else {
            //规则盘口是个范围
            if (
                !(
                    Decimal(input.condition).gte(rule.condition) &&
                    Decimal(input.condition).lte(rule.condition2)
                )
            ) {
                continue
            }
        }

        matchedRule = rule
        break
    }

    if (!matchedRule) return

    //在生成盘口之前，先判断之前有没有其他更小的盘口创建的待抓取盘口
    const smaller = await RockballOdd.findOne({
        where: {
            match_id: input.match_id,
            source_condition: {
                [Op.lte]: input.condition,
            },
        },
        attributes: ['id'],
    })

    //如果已经有更小的盘口创建的就出去了
    if (smaller) return

    //删除更大的来盘创建的盘口
    await RockballOdd.destroy({
        where: {
            match_id: input.match_id,
            source_condition: {
                [Op.gt]: input.condition,
            },
        },
    })

    //开始生成盘口
    for (const oddRule of matchedRule.odds) {
        //尝试寻找相同的盘口
        const odd = await RockballOdd.findOne({
            where: {
                match_id: input.match_id,
                variety: oddRule.variety,
                period: oddRule.period,
                type: oddRule.type,
                condition: oddRule.condition,
            },
        })
        if (odd) {
            //如果盘口已存在，判断一下水位是否更低
            if (Decimal(oddRule.value).lt(odd.value)) {
                //水位更低就按新的水位写入
                odd.value = oddRule.value
                odd.source_variety = input.variety
                odd.source_period = input.period
                odd.source_type = input.type
                odd.source_condition = input.condition
                odd.source_value = input.value ?? '0'
                await odd.save()
            }
        } else {
            //盘口不存在就创建盘口
            await RockballOdd.create({
                match_id: input.match_id,
                crown_match_id: input.crown_match_id,
                source_variety: input.variety,
                source_period: input.period,
                source_condition: input.condition,
                source_type: input.type,
                source_value: input.value ?? '0',
                variety: oddRule.variety,
                period: oddRule.period,
                type: oddRule.type,
                condition: oddRule.condition,
                value: oddRule.value,
                is_open: oddRule.disabled ? 0 : 1,
                source_channel: input.channel,
                source_id: input.id,
            })
        }
    }
}
