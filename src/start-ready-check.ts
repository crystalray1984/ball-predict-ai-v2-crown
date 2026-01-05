import Decimal from 'decimal.js'
import { literal, Op, UniqueConstraintError } from 'sequelize'
import {
    compareValue,
    findRule,
    getOddIdentification,
    getPromotedOddInfo,
    getWeekDay,
    isNullOrUndefined,
} from './common/helpers'
import { close, consume, publish } from './common/rabbitmq'
import { getSetting } from './common/settings'
import { CONFIG } from './config'
import { findMatchedOdd } from './crown'
import { findMainOdd } from './crown/odd'
import { Match, Odd, OddMansion, Promoted, VMatch } from './db'
import { createRockballOddFromPromoted } from './common/rockball'

/**
 * 创建直通推荐盘口
 * @param rule
 * @param match_id
 * @param odd
 */
async function createDirectPromoted(
    rule: DirectConfig,
    match_id: number,
    surebet: Surebet.Output,
    crownOdd: Crown.OddInfo,
) {
    const channel = 'direct'

    //根据规则创建对应的盘口
    let { condition, type } = getPromotedOddInfo(surebet.type, rule.back)
    const odd_type = getOddIdentification(type)

    //进行变盘
    condition = Decimal(condition).add(rule.adjust).toString()

    let is_valid = 1
    let skip = ''

    //检查一下是不是已经存在了同类推荐
    const exists = await Promoted.findOne({
        where: {
            match_id,
            variety: surebet.type.variety,
            period: surebet.type.period,
            odd_type,
            channel,
        },
        attributes: ['id'],
    })

    if (exists) {
        //推荐已经存在了，那就只创建数据，不推送
        is_valid = 0
        skip = ''
        return
    }

    /**
     * 直推推荐的扩展数据
     */
    const extra = {
        surebet: {
            ...surebet.type,
            value: surebet.surebet_value,
        },
        crown_main: {
            condition: crownOdd.condition,
            value1: crownOdd.value_h,
            value2: crownOdd.value_c,
        },
        back: rule.back ? 1 : 0,
    }

    const week_day = getWeekDay()

    //创建推荐数据
    let promoted: Promoted
    try {
        promoted = await Promoted.create({
            match_id,
            source_type: 'direct',
            source_id: 0,
            channel,
            is_valid,
            skip,
            week_day,
            week_id: 0,
            variety: surebet.type.variety,
            period: surebet.type.period,
            type,
            odd_type,
            condition,
            extra,
        })
    } catch (err: unknown) {
        if (err instanceof UniqueConstraintError) {
            //如果是主键冲突那就不管了
            return
        }
        throw err
    }

    //抛到推荐队列
    await publish(
        CONFIG.queues['send_promoted'],
        JSON.stringify({ id: promoted.id, type: 'direct' }),
    )

    //创建滚球盘口
    if (promoted.type === 'over' || promoted.type === 'under') {
        await createRockballOddFromPromoted(promoted.id)
    }
}

/**
 * 处理首次数据比对
 * @param content
 */
async function processReadyCheck(content: string, isMansion: boolean) {
    const { extra, data } = JSON.parse(content) as CrownRobot.Output<Surebet.Output>

    //缺少surebet原始数据就出去了
    if (!extra) return

    //缺少皇冠盘口数据也出去了
    if (!data) return

    //读取配置
    const { ready_condition, direct_config } = await getSetting<string>(
        'ready_condition',
        'direct_config',
    )

    //构建比赛数据
    const [match_id] = await Match.prepare({
        ...data.match,
        match_time: data.match.match_time || extra.match_time,
        ecid: extra.crown_match_id,
    })

    //读取一下比赛数据，如果比赛状态不对那么也不要了
    const match = await VMatch.findOne({
        where: {
            id: match_id,
        },
        attributes: ['id', 'status', 'tournament_is_open'],
    })
    if (!match) return

    //联赛被过滤掉的也去掉
    if (!match.tournament_is_open) return

    //寻找与当前盘口相同的皇冠盘口
    const exists = findMatchedOdd(extra.type, data.odds).find((t) =>
        Decimal(extra.type.condition).eq(t.condition),
    )

    //没有对应的皇冠盘口也出去了
    if (!exists) return

    //直通推荐规则1-二次比对前
    if (!isMansion && Array.isArray(direct_config) && direct_config.length > 0) {
        const rule = findRule<DirectConfig>(
            (direct_config as DirectConfig[]).filter((t) => !t.first_check),
            extra.type,
        )
        if (rule) {
            //有满足条件的直通推荐规则
            await createDirectPromoted(rule, match.id, extra, findMainOdd(extra.type, data.odds)!)
        }
    }

    //比赛状态不对的去掉
    if (match.status !== '') return

    const MainModel = isMansion ? OddMansion : Odd
    const CompareModel = isMansion ? Odd : OddMansion

    let odd = await MainModel.findOne({
        where: {
            crown_match_id: extra.crown_match_id,
            variety: extra.type.variety,
            period: extra.type.period,
            condition: extra.type.condition,
            type: extra.type.type,
        },
    })

    //这个盘口已经存在而且不是等待一次比对的状态，那就出去了
    if (odd && odd.status !== '') {
        return
    }

    let status: OddStatus = 'ready'

    //数据比对
    if (!isNullOrUndefined(ready_condition)) {
        //判断水位是否满足配置的要求
        if (!Decimal(exists.value).sub(extra.surebet_value).gte(ready_condition)) {
            status = ''
        }
    }

    //开始写入数据
    if (odd) {
        //原始盘口已存在
        await MainModel.update(
            {
                surebet_value: extra.surebet_value,
                crown_value: exists.value,
                status,
                ready_at: status === 'ready' ? literal('CURRENT_TIMESTAMP') : null,
            },
            {
                where: {
                    id: odd.id,
                    status: '',
                },
                returning: false,
            },
        )
    } else {
        //原始盘口不存在
        //先尝试插入
        try {
            odd = await MainModel.create({
                match_id,
                crown_match_id: extra.crown_match_id,
                variety: extra.type.variety,
                period: extra.type.period,
                condition: extra.type.condition,
                type: extra.type.type,
                surebet_value: extra.surebet_value,
                crown_value: exists.value,
                status,
                ready_at: status === 'ready' ? (literal('CURRENT_TIMESTAMP') as any) : null,
                odd_type: getOddIdentification(extra.type.type),
            })
        } catch (err) {
            if (err instanceof UniqueConstraintError) {
                //唯一索引冲突错误，再尝试修改
                await MainModel.update(
                    {
                        surebet_value: extra.surebet_value,
                        crown_value: exists.condition,
                        status,
                        ready_at: status === 'ready' ? literal('CURRENT_TIMESTAMP') : null,
                    },
                    {
                        where: {
                            crown_match_id: extra.crown_match_id,
                            variety: extra.type.variety,
                            period: extra.type.period,
                            condition: extra.type.condition,
                            type: extra.type.type,
                            status: '',
                        },
                        returning: false,
                    },
                )

                odd = await MainModel.findOne({
                    where: {
                        crown_match_id: extra.crown_match_id,
                        variety: extra.type.variety,
                        period: extra.type.period,
                        condition: extra.type.condition,
                        type: extra.type.type,
                    },
                })

                if (!odd) {
                    return
                }
            } else {
                //抛出异常
                throw err
            }
        }
    }

    //直通推荐规则2-二次比对后
    if (
        !isMansion &&
        odd.status === 'ready' &&
        Array.isArray(direct_config) &&
        direct_config.length > 0
    ) {
        const rule = findRule<DirectConfig>(
            (direct_config as DirectConfig[]).filter((t) => t.first_check),
            extra.type,
        )
        if (rule) {
            //有满足条件的直通推荐规则
            await createDirectPromoted(rule, match.id, extra, findMainOdd(extra.type, data.odds)!)
        }
    }

    //进行双surebet判断
    if (odd.status === 'ready') {
        const otherOdd = await CompareModel.findOne({
            where: {
                match_id: odd.match_id,
                variety: odd.variety,
                period: odd.period,
                condition: odd.condition,
                type: odd.type,
                status: 'ready',
            },
        })
        if (otherOdd) {
            //从皇冠盘口中寻找大小球盘口
            const crown = data.odds.find((t) => t.variety === 'goal' && t.type === 'ou')
            if (crown) {
                if (isMansion) {
                    await createMansionPromoted(
                        otherOdd,
                        odd,
                        exists.value,
                        exists.value_reverse,
                        crown,
                    )
                } else {
                    await createMansionPromoted(
                        odd,
                        otherOdd,
                        exists.value,
                        exists.value_reverse,
                        crown,
                    )
                }
            }
        }
    }
}

/**
 * 创建mansion推荐
 * @param odd 365对冲盘口
 * @param mansion mansion对冲盘口
 * @param value0 正推水位
 * @param value1 反推水位
 * @param crown 大小球盘口
 */
async function createMansionPromoted(
    odd: Odd,
    mansion: OddMansion,
    value0: string,
    value1: string,
    crown: Crown.OddInfo,
) {
    let is_valid = 1,
        skip = ''

    //读取配置，根据水位区间确定是用正推还是反推
    const { mansion_promote_reverse, mansion_promote_min_value, mansion_promote_max_value } =
        await getSetting(
            'mansion_promote_reverse',
            'mansion_promote_min_value',
            'mansion_promote_max_value',
        )
    //检查水位是否越过了上下限
    if (
        Decimal(value1).lt(mansion_promote_min_value) ||
        Decimal(value1).gt(mansion_promote_max_value)
    ) {
        is_valid = 0
        skip = 'setting'
    }

    //如果盘口本身就是大小球，那么也不推
    if (is_valid === 1 && ['over', 'under'].includes(odd.type)) {
        is_valid = 0
        skip = 'setting'
    }

    //最终要推送的是大球盘

    //如果水位满足条件，再判断有没有同类推送
    if (is_valid) {
        const exists = await Promoted.findOne({
            where: {
                match_id: mansion.match_id,
                variety: mansion.variety,
                period: mansion.period,
                odd_type: 'sum',
                is_valid: 1,
                channel: 'mansion',
            },
            attributes: ['id'],
        })
        if (exists) {
            is_valid = 0
            skip = 'same_type'
        }
    }

    //创建推荐盘口，这里创建的是皇冠主盘的大球
    let condition: string
    let type: OddType
    let back: number
    if (['over', 'under'].includes(odd.type)) {
        //原本就是大小球盘的，按原定方式的反推录入
        const odd = getPromotedOddInfo(mansion, 1)
        condition = odd.condition
        type = odd.type
        back = 1
    } else {
        //原本是让球盘的，根据配置规则，如果有满足规则的推小球，其余的默认推大球
        let reverse = false
        if (Array.isArray(mansion_promote_reverse) && mansion_promote_reverse.length > 0) {
            if (
                mansion_promote_reverse.some((rule: SumCondition) =>
                    compareValue(crown.condition, rule.condition, rule.condition_symbol),
                )
            ) {
                reverse = true
            }
        }
        if (reverse) {
            condition = crown.condition
            type = 'under'
            back = 1
        } else {
            condition = crown.condition
            type = 'over'
            back = 0
        }
    }

    const week_day = getWeekDay()

    let promoted: Promoted
    try {
        promoted = await Promoted.create({
            match_id: mansion.match_id,
            source_type: 'mansion',
            source_id: mansion.id,
            channel: 'mansion',
            is_valid,
            skip,
            week_day,
            week_id: 0,
            variety: mansion.variety,
            period: mansion.period,
            type,
            condition,
            odd_type: 'sum',
            value: value1,
            extra: {
                value0,
                value1,
                odd_id: odd.id,
                mansion_id: mansion.id,
                back,
            },
        })
    } catch {
        return
    }

    if (is_valid) {
        //抛出推荐
        //设置周标记
        const weekLast = await Promoted.findOne({
            where: {
                week_day,
                is_valid: 1,
                id: {
                    [Op.lt]: promoted.id,
                },
                channel: 'mansion',
            },
            order: [['id', 'desc']],
            attributes: ['id', 'week_id'],
        })
        promoted.week_id = weekLast ? weekLast.week_id + 1 : 1
        await promoted.save()
        await publish(
            CONFIG.queues['send_promoted'],
            JSON.stringify({ id: promoted.id, type: 'mansion' }),
        )

        //录入滚球盘
        if (promoted.type === 'under' || promoted.type === 'over') {
            await createRockballOddFromPromoted(promoted.id)
        }
    }
}

/**
 * 开启监听消息队列，处理抓取完皇冠盘口的数据
 */
export async function startReadyCheck() {
    while (true) {
        const [promise] = consume(CONFIG.queues['ready_check_after'], (content) =>
            processReadyCheck(content, false),
        )
        await promise
        await close()
    }
}

/**
 * 开启监听消息队列，处理抓取完皇冠盘口的数据
 */
export async function startReadyCheck2() {
    while (true) {
        const [promise] = consume(CONFIG.queues['ready_check_after2'], (content) =>
            processReadyCheck(content, true),
        )
        await promise
        await close()
    }
}

if (require.main === module) {
    startReadyCheck()
    startReadyCheck2()
}
