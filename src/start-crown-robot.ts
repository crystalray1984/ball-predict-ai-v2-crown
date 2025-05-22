import * as rabbitmq from '@/common/rabbitmq'
import { getCrownData, init, reset, setActiveInterval } from '@/crown'

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
    //设置自动重启皇冠浏览器的时间为1天
    setActiveInterval(86400000)

    while (true) {
        try {
            await init()
            let isProcessing = false
            let isRequestClose = false
            const [promise, close] = rabbitmq.consume('crown_odd', async (content) => {
                isProcessing = true
                try {
                    await processCrownRequest(content)
                } finally {
                    isProcessing = false
                    if (isRequestClose) {
                        close()
                    }
                }
            })

            //15分钟后自动重启
            setTimeout(() => {
                if (isProcessing) {
                    isRequestClose = true
                } else {
                    close()
                }
            }, 900000)
            await promise
        } finally {
            await reset()
            await rabbitmq.close()
        }
    }
}

if (require.main === module) {
    startCrownRobot()
}
