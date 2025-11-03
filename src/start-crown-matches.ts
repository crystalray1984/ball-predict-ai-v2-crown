import { runLoop } from '@/common/helpers'
import { publish } from '@/common/rabbitmq'
import { CONFIG } from '@/config'
import { getCrownMatches, reset } from '@/crown'

/**
 * 开启皇冠比赛列表抓取
 */
export function startCrownMatches() {
    //每半个小时抓取一次
    return runLoop(1800000, async () => {
        //开始抓取皇冠比赛列表
        await reset()
        const matches = await getCrownMatches()

        console.log('采集到比赛数据', matches.length)

        //把数据抛到队列中
        const data = JSON.stringify(matches)

        for (const queue of CONFIG.crown_matches_data_queues) {
            await publish(queue, data)
        }

        await reset()
    })
}

if (require.main === module) {
    startCrownMatches()
}
