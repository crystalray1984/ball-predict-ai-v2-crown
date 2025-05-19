import { runLoop } from '@/common/helpers'
import { publish } from '@/common/rabbitmq'
import { Match, Odd } from '@/db'
import { getSurebets } from '@/surebet'

/**
 * 开启surebet数据抓取
 */
export async function startSurebet() {
    //读取surebet数据
    const list = await getSurebets()
    console.log('满足条件的surebet数据', list.length)
    if (list.length === 0) return

    const output: string[] = []

    for (const surebet of list) {
        //先确定盘口是否存在
        const exists = await Odd.findOne({
            where: {
                crown_match_id: surebet.crown_match_id,
                variety: surebet.type.variety,
                period: surebet.type.period,
                condition: surebet.type.condition,
                type: surebet.type.type,
            },
        })
        if (exists && exists.status !== '') {
            //已经有盘口而且这个盘口的状态不为空那么跳过
            continue
        }

        //判断比赛，如果比赛存在且状态为已结算那么也跳过
        const match = await Match.findOne({
            where: {
                crown_match_id: surebet.crown_match_id,
            },
            attributes: ['id', 'status'],
        })
        if (match && match.status !== '') {
            continue
        }

        //把盘口抛到消息队列进行第一次比对
        output.push(
            JSON.stringify({
                crown_match_id: surebet.crown_match_id,
                next: 'ready_check_after',
                extra: surebet,
            }),
        )
        console.log('抛到消息队列进行第一次比对', surebet.crown_match_id)
    }

    if (output.length > 0) {
        await publish('crown_odd', output)
    }
}

if (require.main === module) {
    runLoop(60000, startSurebet)
}
