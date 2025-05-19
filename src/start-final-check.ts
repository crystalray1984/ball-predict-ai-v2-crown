import {
    getOddIdentification,
    getPromotedOddInfo,
    getPromotedOddInfoBySetting,
    isNullOrUndefined,
    runLoop,
} from '@/common/helpers'
import { consume, publish } from '@/common/rabbitmq'
import { getSetting } from '@/common/settings'
import { findMatchedOdd } from '@/crown'
import { db, Match, Odd, PromotedOdd, Titan007Odd } from '@/db'
import Decimal from 'decimal.js'
import { Attributes, CreationAttributes, literal, Op, QueryTypes } from 'sequelize'

/**
 * 判断是否应该使用球探网的盘口趋势来推荐
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
        return output.some(
            (t) =>
                t.attr.variety === item.attr.variety &&
                t.attr.period === item.attr.period &&
                getOddIdentification(t.attr.type) === getOddIdentification(item.attr.type),
        )
    }

    //进行整理，没有变盘的数据最优先
    for (let i = list.length; i >= 0; i--) {
        const item = list[i]
        if (
            !isNullOrUndefined(item.odd.crown_condition2) &&
            Decimal(item.odd.crown_condition2).eq(item.attr.condition)
        ) {
            if (!item.attr.skip) {
                item.attr.skip = hasSameOdd(item) ? 'same_type' : ''
            }

            output.push(item)
            list.splice(i, 1)
        }
    }

    //然后是已经变盘的数据或者通过球探网匹配的数据，那就按序插入，如果有相同的盘就pass掉
    list.reverse()
    for (const item of list) {
        if (!item.attr.skip) {
            item.attr.skip = hasSameOdd(item) ? 'same_type' : ''
        }
        output.push(item)
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
async function processFinalCheck(
    data: CrownRobot.Output<{
        match_id: number
        odds: Attributes<Odd>[]
        promoted_odd_attrs?: CreationAttributes<PromotedOdd>[]
    }>,
) {
    const { match_id, promoted_odd_attrs = [] } = data.extra!
    const odds = Odd.bulkBuild(data.extra!.odds)

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
            odd.crown_value2 = exact.condition

            //对水位进行对比
            let pass = false
            if (settings.promote_symbol === '<=') {
                pass = Decimal(exact.value).sub(odd.surebet_value).lte(settings.promote_condition)
            } else {
                pass = Decimal(exact.value).sub(odd.surebet_value).gte(settings.promote_condition)
            }

            if (pass) {
                const { condition, type, back } = getPromotedOddInfoBySetting(odd, settings)

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
                    final_rule: 'crown',
                })
            }

            continue
        }

        //没有完全相同的盘口，那么按照达成盘口的难易度做个排序，难以达到的盘口排前面
        let special: { condition: string; value: string } | undefined = undefined
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

        if (!special) {
            //如果没有找到满足条件的变盘，那么就取最接近的盘口，也就是数组中最后一个盘作为二次比对盘
            special = matched_crown_odds[matched_crown_odds.length - 1]
        }

        odd.crown_condition2 = special.condition
        odd.crown_value2 = special.value

        //看看配置是否允许开启变盘
        if (settings.allow_promote_1) {
            //允许变盘，那么就推荐
            const { condition, type, back } = getPromotedOddInfoBySetting(odd, settings)
            promoted_odd_attrs.push({
                match_id,
                odd_id: odd.id,
                manual_promote_odd_id: 0,
                variety: odd.variety,
                period: odd.period,
                condition,
                type,
                back,
                final_rule: 'crown_special',
            })
        }
    }

    //盘口比对完了，现在生成推荐数据
    await generatePromotedOdds(promoted_odd_attrs, odds)
}

/**
 * 处理临近开赛的单场比赛
 */
async function processNearlyMatch(match_id: number, crown_match_id: string) {
    //标记比赛为已处理
    await Match.update({ status: 'final' }, { where: { id: match_id } })

    //首先读取要处理的盘口
    const odds = await Odd.findAll({
        where: {
            match_id,
            status: 'ready',
        },
    })
    if (odds.length === 0) return

    console.log('二次比对', `match_id=${match_id}`, `盘口数=${odds.length}`)

    /**
     * 是否开启了球探网的盘口比对
     */
    const titan007_promote_enable = await getSetting('titan007_promote_enable')

    if (!titan007_promote_enable) {
        //如果没有开启球探网的盘口比对，那就是所有盘口都要走皇冠比对，直接抛进队列里
        await publish(
            'crown_odd',
            JSON.stringify({
                crown_match_id,
                next: 'final_check',
                extra: {
                    match_id,
                    odds,
                },
            }),
        )
        return
    }

    //对盘口进行球探网盘口比对
    const titan007_odd = await Titan007Odd.findOne({
        where: {
            match_id,
        },
    })

    if (!titan007_odd) {
        //如果没有采集到球探网的盘口，那也是所有盘口都要走皇冠比对，直接抛进队列里
        await publish(
            'crown_odd',
            JSON.stringify({
                crown_match_id,
                next: 'final_check',
                extra: {
                    match_id,
                    odds,
                },
            }),
        )
        return
    }

    const promoted_odd_attrs: CreationAttributes<PromotedOdd>[] = []
    const left_odds: Odd[] = []

    for (const odd of odds) {
        //与球探网的盘口进行比对
        const back = isUseTitan007Odd(odd, titan007_odd)
        if (typeof back !== 'undefined') {
            //使用球探网的趋势
            const { condition, type } = getPromotedOddInfo(odd, back)
            promoted_odd_attrs.push({
                match_id,
                odd_id: odd.id,
                manual_promote_odd_id: 0,
                variety: odd.variety,
                period: odd.period,
                condition,
                type,
                back,
                final_rule: 'titan007',
            })
        } else {
            //继续走后续的皇冠盘口判断
            left_odds.push(odd)
        }
    }

    if (left_odds.length > 0) {
        //有盘口需要走皇冠比对
        await publish(
            'crown_odd',
            JSON.stringify({
                crown_match_id,
                next: 'final_check',
                extra: {
                    match_id,
                    odds,
                    promoted_odd_attrs,
                },
            }),
        )
        return
    }

    //所有的盘口都不需要走皇冠比对，那就直接生成推荐数据
    await generatePromotedOdds(promoted_odd_attrs, odds)
}

/**
 * 寻找即将开赛的比赛，把数据抛入到皇冠的二次处理队列中
 */
async function processNearlyMatches() {
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
        ORDER BY
            match_time
        `,
            values: [
                new Date(Date.now() + 60000), //1分钟内开赛的比赛不抓取
                new Date(Date.now() + 300000), //只抓取5分内开赛的比赛
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

    for (const match of matches) {
        try {
            await processNearlyMatch(match.id, match.crown_match_id)
        } catch (err) {
            console.error(err)
        }
    }
}

/**
 * 开始二次数据检查
 */
export async function startFinalCheck() {
    return runLoop(30, processNearlyMatches)
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
