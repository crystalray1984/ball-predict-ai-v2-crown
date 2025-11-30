import { runLoop } from './common/helpers'
import { publish } from './common/rabbitmq'
import { CONFIG } from './config'
import { getAllOdds } from './surebet'

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

/**
 * 开启surebet第二API数据抓取
 */
export async function startSurebet2() {
    //获取所有的surebet数据
    const records = await getAllOdds({
        token: CONFIG.surebet2.token,
        product: 'surebets',
        source: '188bet|mansion88_bti',
        sport: 'Football',
        limit: 100,
        oddsFormat: 'eu',
        outcomes: '2',
        'hide-different-rules': 'True',
        order: 'start_at_asc',
    })

    //抛到后续的队列中
    console.log('mansion', records.length)
    const data = JSON.stringify(records)
    for (const queue of CONFIG.surebet2.next_queues) {
        await publish(queue, data)
    }
}

if (require.main === module) {
    runLoop(60000, startSurebet)
    runLoop(60000, startSurebet2)
}
