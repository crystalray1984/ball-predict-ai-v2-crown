import {
    getOddIdentification,
    getPromotedOddInfo,
    getWeekDay,
    isNullOrUndefined,
} from '@/common/helpers'
import { close, consume, publish } from '@/common/rabbitmq'
import { getSetting } from '@/common/settings'
import { findMatchedOdd } from '@/crown'
import { Match, Odd, OddMansion, PromotedOddMansion, VMatch } from '@/db'
import Decimal from 'decimal.js'
import { literal, Op, UniqueConstraintError } from 'sequelize'
import { CONFIG } from './config'

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
    const ready_condition = await getSetting<string>('ready_condition')

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
    //比赛状态不对的去掉
    if (match.status !== '') return
    //联赛被过滤掉的也去掉
    if (!match.tournament_is_open) return

    //寻找与当前盘口相同的皇冠盘口
    const exists = findMatchedOdd(extra.type, data.odds).find((t) =>
        Decimal(extra.type.condition).eq(t.condition),
    )

    //没有对应的皇冠盘口也出去了
    if (!exists) return

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
            //寻找反向盘口
            const backOdd = {
                ...getPromotedOddInfo(extra.type, 1),
                variety: extra.type.variety,
                period: extra.type.period,
            }
            const backMatched = findMatchedOdd(backOdd, data.odds).find((t) =>
                Decimal(extra.type.condition).eq(t.condition),
            )

            if (isMansion) {
                await createMansionPromoted(otherOdd, odd, exists.value, backMatched!.value)
            } else {
                await createMansionPromoted(odd, otherOdd, exists.value, backMatched!.value)
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
 */
async function createMansionPromoted(
    odd: Odd,
    mansion: OddMansion,
    value0: string,
    value1: string,
) {
    let is_valid = 1,
        skip = ''

    //读取配置，根据水位区间确定是用正推还是反推
    const {
        mansion_promote_reverse,
        mansion_promote_min_value,
        mansion_promote_middle_value,
        mansion_promote_max_value,
    } = await getSetting(
        'mansion_promote_reverse',
        'mansion_promote_min_value',
        'mansion_promote_middle_value',
        'mansion_promote_max_value',
    )

    //根据反推水位和中间点水位来判定正推还是反推
    const back = (() => {
        if (Decimal(value1).gt(mansion_promote_middle_value)) {
            //高水位
            return mansion_promote_reverse ? 0 : 1
        } else {
            //低水位
            return mansion_promote_reverse ? 1 : 0
        }
    })()

    //检查水位是否越过了上下限
    if (
        Decimal(value1).lt(mansion_promote_min_value) ||
        Decimal(value1).gt(mansion_promote_max_value)
    ) {
        is_valid = 0
        skip = 'setting'
    }

    //如果水位满足条件，再判断有没有同类推送
    if (is_valid) {
        const exists = await PromotedOddMansion.findOne({
            where: {
                match_id: mansion.match_id,
                variety: mansion.variety,
                period: mansion.period,
                odd_type: mansion.odd_type,
                is_valid: 1,
            },
            attributes: ['id'],
        })
        if (exists) {
            is_valid = 0
            skip = 'same_type'
        }
    }

    //创建推荐盘口
    const { condition, type } = getPromotedOddInfo(mansion, back)

    const week_day = getWeekDay()

    //插入推荐数据
    const promoted = await PromotedOddMansion.create({
        match_id: mansion.match_id,
        is_valid,
        week_day,
        skip,
        variety: mansion.variety,
        period: mansion.period,
        type,
        condition,
        back,
        value: back ? value1 : value0,
        value0,
        value1,
        odd_type: getOddIdentification(mansion.type),
        odd_id: odd.id,
        odd_mansion_id: mansion.id,
    })

    if (is_valid) {
        //抛出推荐
        //设置周标记
        const weekLast = await PromotedOddMansion.findOne({
            where: {
                week_day,
                is_valid: 1,
                id: {
                    [Op.lt]: promoted.id,
                },
            },
            order: [['id', 'desc']],
            attributes: ['id', 'week_id'],
        })
        promoted.week_id = weekLast ? weekLast.week_id + 1 : 1
        await promoted.save()
        await publish(
            CONFIG.queues['send_promoted'],
            JSON.stringify({ id: promoted.id, type: 'promoted_odd_mansion' }),
        )
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
