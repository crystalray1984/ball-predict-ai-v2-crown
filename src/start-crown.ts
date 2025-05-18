import { getCrownData, getCrownMatches, init } from '@/crown'
import { db, Match, Odd, PromotedOdd, Titan007Odd } from '@/db'
import Decimal from 'decimal.js'
import { groupBy } from 'lodash'
import { CreationAttributes, Op, QueryTypes } from 'sequelize'
import { isNullOrUndefined, runLoop } from './common/helpers'
import { startConsumer } from './common/rabbitmq'
import { getSetting } from './common/settings'
import { findMatchedOdd } from './crown/odd'

/**
 * 开始抓取皇冠比赛数据
 */
function processCrownMatches() {
    //每半个小时抓取一次
    runLoop(1800000, async () => {
        //开始抓取皇冠比赛列表
        const matches = await getCrownMatches()

        console.log('采集到比赛数据', matches.length)

        //插入比赛数据
        let newCount = 0
        for (const match of matches) {
            const [_, isNew] = await Match.prepare(match)
            if (isNew) {
                newCount++
            }
        }
        console.log(`新增比赛数据`, newCount)
    })
}

/**
 * 处理消息队列上收到的surebet数据
 */
async function processSurebet(surebet: Surebet.Output) {
    //首先确定比赛的状态
    const match = await Match.findOne({
        where: {
            crown_match_id: surebet.crown_match_id,
        },
    })
    if (match && match.status !== '') {
        //不是待准备的比赛就不处理了
        return
    }

    let odd = await Odd.findOne({
        where: {
            crown_match_id: surebet.crown_match_id,
            variety: surebet.type.variety,
            period: surebet.type.period,
            condition: surebet.type.condition,
            type: surebet.type.type,
        },
    })
    if (odd && odd.status !== '') return

    //读取比赛的皇冠盘口
    const data = await getCrownData(surebet.crown_match_id)
    if (!data) {
        //没有盘口数据，跳过
        return
    }

    //寻找与当前盘口匹配的盘口
    const matchedOdd = findMatchedOdd(surebet.type, data.odds).find(
        (t) => t.condition === surebet.type.condition,
    )
    if (!matchedOdd) {
        //第一次比对失败，因为没找到对应的盘口，直接抛弃掉
        return
    }

    //找到了对应的盘口，就对水位进行判断
    const ready_condition = await getSetting<string>('ready_condition')

    const status = Decimal(matchedOdd.value).sub(surebet.surebet_value).gte(ready_condition!)
        ? 'ready'
        : ''

    //写入匹配结果
    if (odd) {
        odd.status = status
        odd.surebet_value = surebet.surebet_value
        odd.crown_value = matchedOdd.value
        await odd.save()
    } else {
        const [match_id] = await Match.prepare({
            ...data.match,
            match_time: surebet.match_time,
            ecid: surebet.crown_match_id,
        })

        await Odd.create({
            match_id,
            crown_match_id: surebet.crown_match_id,
            variety: surebet.type.variety,
            period: surebet.type.period,
            condition: surebet.type.condition,
            type: surebet.type.type,
            surebet_value: surebet.surebet_value,
            crown_value: matchedOdd.value,
            status,
        })
    }
}

/**
 * 通过球探网的数据进行盘口判断
 * @returns 返回1表示反推，0表示正推，undefined表示无判断结果
 */
async function finalCheckByTitan007(match_id: number, odd: Odd) {
    //上半场的角球是不存在的，如果盘口是这个状态就直接退出
    if (odd.variety && odd.period === 'period1') return

    //寻找球探网抓取的盘口数据
    const record = await Titan007Odd.findOne({
        where: {
            match_id,
        },
    })
    if (!record) return

    //确认对应的盘口是否存在
    let start: string | null = null,
        end: string | null = null
    if (odd.variety === 'corner') {
        //角球
        switch (odd.type) {
            case 'ah1':
            case 'ah2':
                start = record.corner_ah_start
                end = record.corner_ah_end
                break
            case 'over':
            case 'under':
                start = record.corner_goal_start
                end = record.corner_goal_end
                break
        }
    } else {
        //进球
        if (odd.period === 'regularTime') {
            //全场进球
            switch (odd.type) {
                case 'ah1':
                case 'ah2':
                    start = record.ah_start
                    end = record.ah_end
                    break
                case 'over':
                case 'under':
                    start = record.goal_start
                    end = record.goal_end
                    break
            }
        } else if (odd.period === 'period1') {
            //半场进球
            switch (odd.type) {
                case 'ah1':
                case 'ah2':
                    start = record.ah_period1_start
                    end = record.ah_period1_end
                    break
                case 'over':
                case 'under':
                    start = record.goal_period1_start
                    end = record.goal_period1_end
                    break
            }
        }
    }

    if (isNullOrUndefined(start) || isNullOrUndefined(end)) return

    //如果早盘与即时盘相同，那么也判断失败，继续走后续流程
    if (start === end) return

    //早盘与即时盘不同，那么就要顺应盘口趋势来
    const delta = Decimal(end).comparedTo(start)
    if (delta === 0) return
    if (delta === 1) {
        //盘口变大
        switch (odd.type) {
            case 'ah1':
                //对于让球盘，盘口变大表示趋势倾向于主队
                return 0
            case 'ah2':
                //对于让球盘，盘口变大表示趋势倾向于主队
                return 1
            case 'under':
                //对于总数盘，盘口变大表示趋势倾向于大球
                return 1
            case 'over':
                //对于总数盘，盘口变大表示趋势倾向于大球
                return 0
        }
    } else {
        //盘口变小
        switch (odd.type) {
            case 'ah1':
                //对于让球盘，盘口变小表示趋势倾向于客队
                return 1
            case 'ah2':
                //对于让球盘，盘口变小表示趋势倾向于客队
                return 0
            case 'under':
                //对于总数盘，盘口变小表示趋势倾向于小球
                return 0
            case 'over':
                //对于总数盘，盘口变小表示趋势倾向于小球
                return 1
        }
    }
}

/**
 * 根据正推反推返回推荐盘口的数据
 * @param odd
 * @param back
 */
function getFinalOddData(
    odd: Pick<OddInfo, 'condition' | 'type'>,
    back: number,
): Pick<OddInfo, 'condition' | 'type'> {
    if (!back) {
        //正推，直接返回相同的数据
        return {
            condition: odd.condition,
            type: odd.type,
        }
    } else {
        //反推，要根据盘口类型来
        switch (odd.type) {
            case 'ah1':
                return {
                    condition: Decimal(0).sub(odd.condition).toString(),
                    type: 'ah2',
                }
            case 'ah2':
                return {
                    condition: Decimal(0).sub(odd.condition).toString(),
                    type: 'ah1',
                }
            case 'over':
                return {
                    condition: odd.condition,
                    type: 'under',
                }
            case 'under':
                return {
                    condition: odd.condition,
                    type: 'over',
                }
        }
        return {
            condition: odd.condition,
            type: odd.type,
        }
    }
}

/**
 * 处理开赛前的最终判断
 */
async function processFinalMatch(match_id: number, crown_match_id: string, odds: Odd[]) {
    //首先把比赛标记为fianl，也就是已经结算
    await Match.update(
        {
            status: 'final',
        },
        {
            where: {
                id: match_id,
            },
        },
    )

    //读取配置
    const settings = await getSetting(
        'allow_promote_1',
        'promote_symbol',
        'corner_reverse',
        'promote_reverse',
        'period1_enable',
        'promote_condition',
        'corner_enable',
        'corner_period1_enable',
        'special_reverse',
        'filter_rate',
        'titan007_promote_enable',
    )

    let promoted_odd_attrs: CreationAttributes<PromotedOdd>[] = []

    for (const odd of odds) {
        //首先根据盘口的类型，由系统配置做出筛选
        const is_skip = (() => {
            if (!settings.corner_enable && odd.variety === 'corner') return 1
            if (
                !settings.corner_period1_enable &&
                odd.variety === 'corner' &&
                odd.period === 'period1'
            )
                return 1
            if (!settings.period1_enable && odd.period === 'period1') return 1
            return 0
        })()

        //第一步根据配置判断是否从球探网抓取盘口进行判断
        if (settings.titan007_promote_enable) {
            const back = await finalCheckByTitan007(match_id, odd)
            if (typeof back === 'number') {
                const { condition, type } = getFinalOddData(odd, back)
                //球探网的盘口判断有结果，那么直接完成最终判断
                promoted_odd_attrs.push({
                    match_id,
                    odd_id: odd.id,
                    variety: odd.variety,
                    period: odd.period,
                    is_skip,
                    final_rule: 'titan007',
                    condition,
                    type,
                    back,
                })
                odd.status = 'promoted'
                continue
            }
        }

        //球探网判断无结果，或者开关没打开，就进入第二次判断，皇冠盘口判断
        let crown_data: Crown.OddData | undefined = undefined
        try {
            crown_data = await getCrownData(crown_match_id)
        } catch {}
        if (!crown_data) {
            //没有抓到数据，表示第二次判断失败
            odd.status = 'ignored'
            await odd.save()
            continue
        }

        /**
         * 是否通过了二次判断
         */
        let pass = false
        /**
         * 是因为什么规则通过了二次判断
         */
        let final_rule: PromotedFinalRule = 'crown'
        /**
         * 特殊规则盘口数据
         */
        let special_odd: { condition: string; value: string } | undefined = undefined

        //抓到了数据就进行第二次判断
        const matched_odds = findMatchedOdd(odd, crown_data.odds)

        //首先寻找与当前盘口相同的盘口
        const exact = matched_odds.find((t) => t.condition === odd.condition)
        if (exact) {
            //有完全相同的盘口，那就进行水位判断
            pass = (() => {
                const value = Decimal(exact.value).sub(odd.surebet_value)
                if (settings.promote_symbol === '<=') {
                    return value.lte(settings.promote_condition)
                } else {
                    return value.gte(settings.promote_condition)
                }
            })()
            odd.crown_condition2 = odd.condition
            odd.crown_value2 = exact.value
        } else if (settings.allow_promote_1) {
            //没有找到完全相同的盘口，而且开关也打开了，那就进行特殊规则判断
            final_rule = 'crown_special'
            let sort: 'asc' | 'desc' = 'asc'
            switch (odd.type) {
                case 'ah1':
                case 'ah2':
                case 'under':
                    sort = 'asc'
                    break
                default:
                    sort = 'desc'
                    break
            }

            //把当前所有的皇冠盘口，按排序规则排序
            if (sort === 'asc') {
                matched_odds.sort((t1, t2) => Decimal(t1.condition).comparedTo(t2.condition))
                special_odd = matched_odds.find((t) => Decimal(t.condition).gt(odd.condition))
            } else {
                matched_odds.sort((t1, t2) => Decimal(t2.condition).comparedTo(t1.condition))
                special_odd = matched_odds.find((t) => Decimal(t.condition).lt(odd.condition))
            }
            if (special_odd) {
                pass = true
                odd.status = 'promoted'
            } else {
                special_odd = matched_odds[matched_odds.length - 1]
                odd.status = 'ignored'
            }
            odd.crown_condition2 = special_odd.condition
            odd.crown_value2 = special_odd.value
        }

        if (pass) {
            //盘口通过了最终判断，那么就添加推荐数据

            //在添加推荐数据之前要确定是正推还是反推
            const back = (() => {
                //首先对特殊逻辑进行判断
                if (settings.special_reverse && Array.isArray(settings.special_reverse)) {
                    const found = settings.special_reverse.find((rule) => {
                        if (
                            rule.period !== odd.period ||
                            rule.variety !== rule.variety ||
                            rule.type !== odd.type
                        ) {
                            return false
                        }
                        switch (rule.condition_symbol) {
                            case '>=':
                                return Decimal(odd.condition).gte(rule.condition)
                            case '>':
                                return Decimal(odd.condition).gt(rule.condition)
                            case '<=':
                                return Decimal(odd.condition).lte(rule.condition)
                            case '<':
                                return Decimal(odd.condition).lt(rule.condition)
                            default:
                                return Decimal(odd.condition).eq(rule.condition)
                        }
                    })
                    if (found) {
                        return found.back ? 1 : 0
                    }
                }

                //然后是常规的正反推逻辑
                if (odd.variety === 'corner') {
                    return settings.corner_reverse ? 1 : 0
                } else {
                    return settings.promote_reverse ? 1 : 0
                }
            })()

            //根据正推反推确定盘口
            const { condition, type } = getFinalOddData(odd, back)

            promoted_odd_attrs.push({
                match_id,
                odd_id: odd.id,
                variety: odd.variety,
                period: odd.period,
                is_skip,
                final_rule,
                condition,
                type,
                back,
            })
        }
    }

    //最终推荐盘口的处理

    //做第一次筛选，相同的盘口类型，如果存在正反两个结果，那么以odd_id更大的结果为准(也就是后接收的盘口)
    let filtred_promoted_odds: CreationAttributes<PromotedOdd>[] = []
    for (const attrs of promoted_odd_attrs) {
        const opp_index = filtred_promoted_odds.findIndex((t) => {
            if (t.variety !== attrs.variety || t.period !== attrs.period) {
                return false
            }
            switch (attrs.type) {
                case 'ah1':
                    return t.type === 'ah2'
                case 'ah2':
                    return t.type === 'ah1'
                case 'over':
                    return t.type === 'under'
                case 'under':
                    return t.type === 'over'
            }
        })
        if (opp_index === -1) {
            //没有相反的盘口就插入进去
            filtred_promoted_odds.push(attrs)
            continue
        }

        //有相反的盘口就要留下id更大的那个
        //新数据的odd_id更大，那就删除旧的，插入新的
        filtred_promoted_odds.splice(opp_index, 1)
        filtred_promoted_odds.push(attrs)
    }

    //第二次筛选，相同的盘口，只留下更容易中的盘口
    //先把过滤后的盘口按相同的类型进行分组
    const grouped = groupBy(filtred_promoted_odds, (t) => `${t.variety}|${t.period}|${t.type}`)
    filtred_promoted_odds = []
    for (const group of Object.values(grouped)) {
        //如果组只有一个元素就不需要排序了，直接放入
        if (group.length === 1) {
            filtred_promoted_odds.push(group[0])
            continue
        }

        //根据投注类型，取同组内较为容易中的盘口，其实就是根据不同的下注类型，对组进行排序后，取第一个
        switch (group[0].type) {
            case 'ah1':
            case 'ah2':
            case 'under':
                //主客和小球，取让球更少或者受让更多的，也就是condition更大的
                group.sort((t1, t2) => Decimal(t2.condition).comparedTo(t1.condition))
                filtred_promoted_odds.push(group[0])
                break
            case 'over':
                //大球，取大小球边界更小的
                group.sort((t1, t2) => Decimal(t1.condition).comparedTo(t2.condition))
                filtred_promoted_odds.push(group[0])
                break
        }
    }

    //开始插入最终数据

    const skiped_attrs = filtred_promoted_odds.filter((t) => t.is_skip)
    filtred_promoted_odds = filtred_promoted_odds.filter((t) => !t.is_skip)

    //首先插入因规则过滤掉的盘口
    for (const attrs of skiped_attrs) {
        await PromotedOdd.create(attrs, { returning: false })
    }

    //然后插入普通的盘口
    for (const attrs of filtred_promoted_odds) {
        let is_valid = settings.filter_rate === 4 ? 1 : 0
        const odd = await PromotedOdd.create(
            {
                ...attrs,
                is_valid,
            },
            { returning: ['id'] },
        )
        if (is_valid) continue

        //根据筛选率，计算这个盘口要不要推荐
        const odd_count = await PromotedOdd.count({
            where: {
                is_skip: 0,
                manual_promote_odd_id: 0,
                id: {
                    [Op.lt]: odd.id,
                },
            },
        })
        switch (settings.filter_rate) {
            case 1:
                //4选1
                is_valid = odd_count % 4 === 0 ? 1 : 0
                break
            case 2:
                //2选1
                is_valid = odd_count % 2 === 0 ? 1 : 0
                break
            case 3:
                //4选3
                is_valid = odd_count % 4 === 3 ? 0 : 1
                break
        }
        if (is_valid) {
            await PromotedOdd.update({ is_valid }, { where: { id: odd.id }, returning: false })
        }
    }
}

/**
 * 处理临近开场的比赛
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
            DISTINCT
            a.id,
            a.crown_match_id
        FROM
            \`match\` AS a
        INNER JOIN
            odd ON odd.match_id = a.id AND odd.status = ?
        WHERE
            a.match_time >= ?
            AND a.match_time <= ?
            AND a.status = ?
        ORDER BY
            a.match_time
        `,
            values: [
                'ready',
                new Date(Date.now()), //已经开赛的比赛不抓取
                new Date(Date.now() + 300000), //只抓取5分内开赛的比赛
                '', //只选择还未结算的比赛
            ],
        },
        {
            type: QueryTypes.SELECT,
        },
    )
    console.log('需要二次比对的比赛', matches.length)
    if (matches.length === 0) return

    //读取需要抓取的盘口
    const odds = await Odd.findAll({
        where: {
            match_id: {
                [Op.in]: matches.map((t) => t.id),
            },
            status: 'ready',
        },
        order: [['id', 'asc']],
    })

    console.log('需要二次比对的盘口', odds.length)
    if (odds.length === 0) return

    for (const match of matches) {
        const matchOdds = odds.filter((t) => t.match_id === match.id)
        if (matchOdds.length === 0) continue
        try {
            await processFinalMatch(match.id, match.crown_match_id, matchOdds)
        } catch (err) {
            console.error(err)
        }
    }
}

/**
 * 开启皇冠数据抓取
 */
export async function startCrown() {
    //首先初始化皇冠环境
    await init()

    //开启比赛数据抓取
    runLoop(1800000, processCrownMatches)

    //处理临近开场的比赛
    runLoop(30000, processNearlyMatches)

    //开启消息队列做第一次数据比对
    startConsumer('ready_check', async (jsonStr) => {
        const data = JSON.parse(jsonStr)
        await processSurebet(data)
    })
}

if (require.main === module) {
    startCrown()
}
