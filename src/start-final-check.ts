import {
    findRule,
    getOddIdentification,
    getPromotedOddInfoBySetting,
    isNullOrUndefined,
    runLoop,
} from '@/common/helpers'
import { consume, publish } from '@/common/rabbitmq'
import { getSetting } from '@/common/settings'
import { findMatchedOdd } from '@/crown'
import { db, Match, Odd, PromotedOdd } from '@/db'
import Decimal from 'decimal.js'
import { CreationAttributes, literal, Op, QueryTypes } from 'sequelize'

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
    for (const item of list) {
        const found = findRule<AdjustConditionRule>(settings.adjust_condition, item.attr)
        if (found) {
            //有变盘规则
            item.attr.condition = Decimal(item.attr.condition).add(found.adjust).toString()
        }
    }

    //开始插入最终数据
    const filter_rate = settings.filter_rate ?? 4
    for (const item of output) {
        if (filter_rate === 4) {
            //不需要考虑筛选率
            item.attr.is_valid = item.attr.skip ? 0 : 1
        }
        const promoted = await PromotedOdd.create(item.attr, {
            returning: ['id'],
        })
        if (item.attr.skip) {
            //不是被跳过的数据才有资格根据筛选率筛选数据，否则就直接跳过
            continue
        }
        if (filter_rate === 4) {
            //全筛选率也不需要特殊处理
            continue
        }

        const count = await PromotedOdd.count({
            where: {
                skip: '',
                manual_promote_odd_id: 0,
                id: {
                    [Op.lte]: promoted.id,
                },
            },
        })

        switch (filter_rate) {
            case 1:
                item.attr.is_valid = count % 4 === 3 ? 1 : 0
                break
            case 2:
                item.attr.is_valid = count % 2
                break
            case 3:
                item.attr.is_valid = count % 3 > 0 ? 1 : 0
                break
        }
        if (item.attr.is_valid === 1) {
            await PromotedOdd.update({ is_valid: 1 }, { where: { id: promoted.id } })
        }
    }

    //开始更新原始盘口数据
    for (const odd of odds) {
        await Odd.update(
            {
                status: attrs.some((t) => t.odd_id === odd.id) ? 'promoted' : 'ignored',
                crown_condition2: odd.crown_condition2,
                crown_value2: odd.crown_value2,
                final_at: literal('CURRENT_TIMESTAMP'),
                final_rule: odd.final_rule,
            },
            {
                where: {
                    id: odd.id,
                },
            },
        )
    }
}

/**
 * 把原始盘口数据和拿到的皇冠盘口数据进行最终数据判断
 * @param data
 */
export async function processFinalCheck(
    data: CrownRobot.Output<{
        match_id: number
    }>,
) {
    const promoted_odd_attrs: CreationAttributes<PromotedOdd>[] = []
    const { match_id } = data.extra!
    const odds = await Odd.findAll({
        where: {
            match_id,
            status: 'ready',
        },
    })

    if (!data.data) {
        //没有抓到盘口数据，那么所有的推荐都不生效，只有通过了球探网的数据才有效
        await generatePromotedOdds(promoted_odd_attrs, odds)
        return
    }

    const settings = await getSetting(
        'promote_symbol',
        'promote_condition',
        'allow_promote_1',
        'corner_reverse',
        'promote_reverse',
        'special_reverse',
        'titan007_reverse',
    )

    //继续进行皇冠盘口比对
    for (const odd of odds) {
        //先寻找对应的盘口
        const matched_crown_odds = findMatchedOdd(odd, data.data!.odds)
        if (matched_crown_odds.length === 0) {
            //连盘口都没开，就视同于没有抓到盘口
            continue
        }

        //首先找完全相同的盘口
        const exact = matched_crown_odds.find((t) => Decimal(t.condition).eq(odd.condition))

        //在有完全相同的盘口的前提下，按照原盘口创建推荐数据
        if (exact) {
            odd.crown_condition2 = odd.condition
            odd.crown_value2 = exact.value
            odd.final_rule = 'crown'

            //对水位进行对比
            let pass = false
            if (settings.promote_symbol === '<=') {
                pass = Decimal(exact.value).sub(odd.surebet_value).lte(settings.promote_condition)
            } else {
                pass = Decimal(exact.value).sub(odd.surebet_value).gte(settings.promote_condition)
            }

            if (pass) {
                const { condition, type, back, final_rule } = await getPromotedOddInfoBySetting(
                    match_id,
                    odd,
                    settings,
                )

                //水位对比成功，添加推荐数据
                promoted_odd_attrs.push({
                    match_id,
                    odd_id: odd.id,
                    manual_promote_odd_id: 0,
                    variety: odd.variety,
                    period: odd.period,
                    condition,
                    type,
                    back,
                    final_rule,
                })
            }

            continue
        }

        //没有完全相同的盘口，那么按照达成盘口的难易度做个排序，难以达到的盘口排前面
        let special: { condition: string; value: string } | undefined = undefined
        let pass = false
        switch (odd.type) {
            case 'ah1':
            case 'ah2':
                //让球盘，数值越小越难
                matched_crown_odds.sort((t1, t2) => Decimal(t1.condition).comparedTo(t2.condition))
                special = matched_crown_odds.find((t) => Decimal(t.condition).gte(odd.condition))
                break
            case 'under':
                //小球盘，盘口数值越小越难
                matched_crown_odds.sort((t1, t2) => Decimal(t1.condition).comparedTo(t2.condition))
                special = matched_crown_odds.find((t) => Decimal(t.condition).gte(odd.condition))
                break
            case 'over':
                //大球盘，盘口数值越大越难
                matched_crown_odds.sort((t1, t2) => Decimal(t2.condition).comparedTo(t1.condition))
                special = matched_crown_odds.find((t) => Decimal(t.condition).lte(odd.condition))
                break
        }

        pass = !!special
        if (!special) {
            //如果没有找到满足条件的变盘，那么就取最接近的盘口，也就是数组中最后一个盘作为二次比对盘
            special = matched_crown_odds[matched_crown_odds.length - 1]
        }

        odd.crown_condition2 = special.condition
        odd.crown_value2 = special.value

        //看看配置是否允许开启变盘
        if (settings.allow_promote_1 && pass) {
            //允许变盘，那么就推荐
            const { condition, type, back, final_rule } = await getPromotedOddInfoBySetting(
                match_id,
                odd,
                settings,
            )
            promoted_odd_attrs.push({
                match_id,
                odd_id: odd.id,
                manual_promote_odd_id: 0,
                variety: odd.variety,
                period: odd.period,
                condition,
                type,
                back,
                final_rule,
            })
            odd.final_rule = 'crown_special'
        }
    }

    //盘口比对完了，现在生成推荐数据
    await generatePromotedOdds(promoted_odd_attrs, odds)
}

/**
 * 寻找即将开赛的比赛，把数据抛入到皇冠的二次处理队列中
 */
async function processNearlyMatches() {
    //读取开赛时间配置
    const final_check_time = (await getSetting<number>('final_check_time')) ?? 5

    //先查询需要处理的比赛
    const matches = await db.query<{
        id: number
        crown_match_id: string
    }>(
        {
            query: `
        SELECT
            id,
            crown_match_id
        FROM
            match
        WHERE
            match_time BETWEEN ? AND ?
            AND status = ?
            AND id IN (SELECT match_id FROM odd WHERE status = ?)
        `,
            values: [
                new Date(Date.now() + 15000), //15秒内
                new Date(Date.now() + final_check_time * 60000), //只抓取5分内开赛的比赛
                '', //只选择还未结算的比赛
                'ready', //有准备中的盘口的比赛
            ],
        },
        {
            type: QueryTypes.SELECT,
        },
    )
    console.log('需要二次比对的比赛', matches.length)
    if (matches.length === 0) return

    //把数据抛入队列
    await publish(
        'crown_odd',
        matches.map((match) => {
            return JSON.stringify({
                next: 'final_check',
                crown_match_id: match.crown_match_id,
                extra: {
                    match_id: match.id,
                },
            })
        }),
    )

    //把比赛标记为已完成
    await Match.update(
        {
            status: 'final',
        },
        {
            where: {
                id: {
                    [Op.in]: matches.map((t) => t.id),
                },
            },
        },
    )
}

/**
 * 开始二次数据检查
 */
export async function startFinalCheck() {
    return runLoop(30000, processNearlyMatches)
}

/**
 * 开始带有皇冠盘口数据的二次数据检查
 */
export async function startFinalCrownCheck() {
    const [promise] = consume('final_check', async (content) => {
        await processFinalCheck(JSON.parse(content))
    })
    await promise
}

if (require.main === module) {
    startFinalCheck()
    startFinalCrownCheck()
}
