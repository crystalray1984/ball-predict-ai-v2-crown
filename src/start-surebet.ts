import { runLoop } from '@/common/helpers'
import { publish } from '@/common/rabbitmq'
import { getAllOdds } from '@/surebet'
import { CONFIG } from './config'

/**
 * 开启surebet数据抓取
 */
export async function startSurebet() {
    //获取所有的surebet数据
    const records = await getAllOdds({
        token: CONFIG.surebet.token,
        product: 'surebets',
        source: '188bet|bet365',
        sport: 'Football',
        limit: 100,
        oddsFormat: 'eu',
        outcomes: '2',
        'hide-different-rules': 'True',
        order: 'start_at_asc',
    })

    //抛到后续的队列中
    const data = JSON.stringify(records)
    for (const queue of CONFIG.surebet.next_queues) {
        await publish(queue, data)
    }
}

if (require.main === module) {
    runLoop(60000, startSurebet)
}
