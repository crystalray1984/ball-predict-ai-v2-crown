import { checkChannel2Publish, isNullOrUndefined } from '@/common/helpers'
import { close, consume } from '@/common/rabbitmq'
import { getSetting } from '@/common/settings'
import { findMatchedOdd } from '@/crown'
import { Match, Odd } from '@/db'
import Decimal from 'decimal.js'
import { literal, UniqueConstraintError } from 'sequelize'

/**
 * 处理首次数据比对
 * @param content
 */
async function processReadyCheck(content: string) {
    const { extra, data } = JSON.parse(content) as CrownRobot.Output<Surebet.Output>

    //缺少surebet原始数据就出去了
    if (!extra) return

    //缺少皇冠盘口数据也出去了
    if (!data) return

    //寻找与当前盘口相同的皇冠盘口
    const exists = findMatchedOdd(extra.type, data.odds).find((t) =>
        Decimal(extra.type.condition).eq(t.condition),
    )

    //没有对应的皇冠盘口也出去了
    if (!exists) return

    //读取配置
    const ready_condition = await getSetting<string>('ready_condition')

    let odd = await Odd.findOne({
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
        await Odd.update(
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
        const [match_id] = await Match.prepare({
            ...data.match,
            match_time: extra.match_time,
            ecid: extra.crown_match_id,
        })
        //先尝试插入
        try {
            odd = await Odd.create({
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
            })
        } catch (err) {
            if (err instanceof UniqueConstraintError) {
                //唯一索引冲突错误，再尝试修改
                await Odd.update(
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

                odd = await Odd.findOne({
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

    //特殊的通道2判断
    await checkChannel2Publish(odd)
}

/**
 * 开启监听消息队列，处理抓取完皇冠盘口的数据
 */
export async function startReadyCheck() {
    while (true) {
        const [promise] = consume('ready_check_after', processReadyCheck)
        await promise
        await close()
    }
}

if (require.main === module) {
    startReadyCheck()
}
