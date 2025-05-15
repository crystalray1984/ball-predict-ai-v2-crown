import { ConfirmChannel, connect } from 'amqplib'
import { CONFIG } from './config'
import { singleton } from './helpers'

type MessageConsumer = (content: string) => any | Promise<any>

/**
 * 创建Rabbitmq客户端
 */
export async function createClient() {
    const connection = await connect(CONFIG.rabbitmq)
    const sym = Symbol()

    /**
     * 负责发布的通道
     */
    let publishChannel = undefined as unknown as ConfirmChannel

    /**
     * 发布数据到指定队列
     * @param queue 队列名
     * @param content 待发送的数据
     */
    const publish = async (queue: string, content: string) => {
        if (!publishChannel) {
            publishChannel = await singleton(sym, () => connection.createConfirmChannel())
        }
        await publishChannel.assertQueue(queue)
        await new Promise<void>((resolve, reject) => {
            publishChannel.sendToQueue(queue, Buffer.from(content, 'utf-8'), {}, (err) => {
                if (err) {
                    reject(err)
                } else {
                    resolve()
                }
            })
        })
    }

    /**
     * 开始对指定的队列进行消费
     */
    const consume = async (queue: string, consumer: MessageConsumer, prefetchCount = 1) => {
        const channel = await connection.createChannel()
        await channel.assertQueue(queue)
        await channel.prefetch(prefetchCount)

        return new Promise<void>(async (_, reject) => {
            /**
             * 当发生异常时进行的操作
             * @param err
             */
            const onError = async (err: any) => {
                console.error(err)
                await channel.cancel(consumerTag)
                await channel.close()
                reject(err)
            }

            const { consumerTag } = await channel.consume(queue, async (msg) => {
                if (!msg) {
                    //服务器已断开连接
                    onError(new Error('rabbitmq服务器断开连接'))
                    return
                }

                const content = msg.content.toString('utf-8')
                try {
                    await consumer(content)
                    channel.ack(msg)
                } catch (err) {
                    console.error(err)
                    channel.nack(msg)
                }
            })
        })
    }

    return {
        publish,
        consume,
    }
}
