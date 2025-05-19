import * as rabbitmq from '@/common/rabbitmq'
import { getCrownData, init } from '@/crown'

/**
 * 处理从消费队列中来的皇冠盘口抓取请求
 */
export async function processCrownRequest(content: string) {
    const { next, crown_match_id, extra } = JSON.parse(content) as CrownRobot.Input

    //读取皇冠的盘口
    const data = await getCrownData(crown_match_id, 'today')

    //抛到下一个队列
    await rabbitmq.publish(
        next,
        JSON.stringify({
            crown_match_id,
            extra,
            data,
        }),
    )
}

/**
 * 开启皇冠盘口抓取
 */
async function startCrownRobot() {
    while (true) {
        await init()
        try {
            const [promise] = rabbitmq.consume('crown_odd', processCrownRequest)
            await promise
        } finally {
            await rabbitmq.close()
        }
    }
}

if (require.main === module) {
    startCrownRobot()
}
