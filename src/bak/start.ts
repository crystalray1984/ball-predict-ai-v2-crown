import { createClient } from './amqp'
import { getCrownData, getCrownMatches, initCrown } from './crown'
import { Match } from './db'
import { RateLimiter } from './helpers'

/**
 * 预先读取皇冠的比赛数据
 */
async function prefetchMatches() {
    const limiter = new RateLimiter(1800000)
    while (true) {
        await limiter.next()
        try {
            //抓取皇冠比赛列表
            const matches = await getCrownMatches()

            //插入比赛
            for (const match of matches) {
                await Match.prepare({
                    ...match,
                    crown_match_id: match.ecid,
                })
            }
        } catch (err) {
            console.error(err)
        }
    }
}

export async function main() {
    //初始化浏览器环境
    await initCrown()

    //开启获取皇冠比赛数据的任务
    prefetchMatches()

    //打开rabbitmq连接
    const rabbitmq = await createClient()

    //打开监听通道
    await rabbitmq.consume('crown_robot', async (msg) => {
        const data: CrownQueueInputData = JSON.parse(msg)

        //读取皇冠盘口数据
        const result = await getCrownData(data.crown_match_id)

        //抛到下一个队列
        await rabbitmq.publish(
            data.next,
            JSON.stringify({
                crown_match_id: data.crown_match_id,
                result,
                extra: data.extra,
            }),
        )
    })
}

if (require.main === module) {
    main().finally(() => process.exit())
}
