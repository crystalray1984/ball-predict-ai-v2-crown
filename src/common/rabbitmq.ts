import { CONFIG } from '@/config'
import { ChannelModel, ConfirmChannel, connect, Options } from 'amqplib'
import { singleton } from './singleton'

let connection = null as unknown as ChannelModel
let publishChannel = null as unknown as ConfirmChannel
const assertedQueues: string[] = []

/**
 * 准备好客户端连接
 */
async function ready() {
    if (connection) return
    return singleton('rabbitmq_connection', async () => {
        connection = await connect(CONFIG.rabbitmq)
        console.log('[rabbitmq]', '开启客户端连接', CONFIG.rabbitmq.hostname)
    })
}

/**
 * 关闭客户端连接
 */
export async function close() {
    if (publishChannel) {
        await publishChannel.close()
        console.log('[rabbitmq]', '关闭发布通道')
        publishChannel = null as any
    }
    if (!connection) return
    await connection.close()
    assertedQueues.splice(0, assertedQueues.length)
    console.log('[rabbitmq]', '关闭客户端连接')
    connection = null as unknown as ChannelModel
}

/**
 * 队列定义
 */
export interface QueueConfig {
    /**
     * 队列名称
     */
    name: string
    /**
     * 队列定义参数
     */
    assert?: Options.AssertQueue
    /**
     * 交换机参数
     */
    exchange?: Options.AssertExchange & {
        type?: 'direct' | 'topic' | 'headers' | 'fanout' | 'match' | string
    }
}

async function publishReady() {
    if (publishChannel) return
    return singleton('rabbitmq_publish', async () => {
        await ready()
        publishChannel = await connection.createConfirmChannel()
        console.log('[rabbitmq]', '开启发布通道', CONFIG.rabbitmq.hostname)
    })
}

/**
 * 发布数据到消息队列
 * @param queue 队列定义
 * @param content
 * @param options
 */
export async function publish(
    queue: string | QueueConfig,
    content: string | string[],
    options?: Options.Publish,
) {
    await publishReady()

    const config = typeof queue === 'string' ? { name: queue } : queue

    //初始化队列
    if (!assertedQueues.includes(config.name)) {
        await publishChannel.assertQueue(config.name, config.assert)
        if (config.exchange) {
            const { type, ...exchangeOptions } = config.exchange
            await publishChannel.assertExchange(config.name, type ?? 'direct', exchangeOptions)
            await publishChannel.bindQueue(config.name, config.name, '', exchangeOptions.arguments)
        }
    }

    if (!assertedQueues.includes(config.name)) {
        assertedQueues.push(config.name)
    }

    //发送数据
    const send = (content: string) => {
        if (config.exchange) {
            publishChannel.publish(config.name, '', Buffer.from(content, 'utf-8'), options)
        } else {
            publishChannel.sendToQueue(config.name, Buffer.from(content, 'utf-8'), options)
        }
    }

    if (Array.isArray(content)) {
        content.forEach((data) => send(data))
    } else {
        send(content)
    }
    await publishChannel.waitForConfirms()
}

export interface ConsumeOptions extends Options.Consume {
    prefetchCount?: number
}

export interface ConsumeContext {
    ack(): void
    nack(): void
    requeue(): void
}

/**
 * 开启队列消费
 * @param queue
 * @param callback
 * @param options
 */
export function consume(
    queue: string | QueueConfig,
    callback: (content: string, context: ConsumeContext) => any,
    options: ConsumeOptions = {},
): [Promise<void>, () => void] {
    const controller = new AbortController()
    const close = () => controller.abort()
    const { prefetchCount = 1, ...rest } = options

    const promise = (async () => {
        await ready()
        if (controller.signal.aborted) return
        const channel = await connection.createChannel()
        try {
            if (controller.signal.aborted) return
            await channel.prefetch(prefetchCount)
            if (controller.signal.aborted) return

            //队列确认
            const config = typeof queue === 'string' ? { name: queue } : queue
            //初始化队列
            await channel.assertQueue(config.name, config.assert)
            if (config.exchange) {
                const { type, ...exchangeOptions } = config.exchange
                await channel.assertExchange(config.name, type ?? 'direct', exchangeOptions)
                await channel.bindQueue(config.name, config.name, '', exchangeOptions.arguments)
            }

            if (controller.signal.aborted) return
            await new Promise<void>(async (resolve, reject) => {
                const { consumerTag } = await channel.consume(
                    config.name,
                    async (msg) => {
                        let action: 'ack' | 'nack' | 'requeue' | '' = ''
                        const ack = () => {
                            action = 'ack'
                        }
                        const nack = () => {
                            action = 'nack'
                        }
                        const requeue = () => {
                            action = 'requeue'
                        }
                        const ctx = {
                            ack,
                            nack,
                            requeue,
                        }

                        if (!msg) {
                            reject(new Error('rabbitmq服务器已断开连接'))
                            return
                        }
                        try {
                            await callback(msg.content.toString('utf-8'), ctx)
                            if (!action) {
                                action = 'ack'
                            }
                        } catch (err) {
                            console.error(err)
                            if (!action) {
                                action = 'nack'
                            }
                        }
                        switch (action as any) {
                            case 'nack':
                                channel.nack(msg)
                                break
                            case 'requeue':
                                channel.reject(msg, true)
                                break
                            default:
                                channel.ack(msg)
                                break
                        }
                    },
                    rest,
                )
                console.log('[rabbitmq]', '开启队列监听', queue)
                if (controller.signal.aborted) {
                    await channel.cancel(consumerTag)
                    resolve()
                } else {
                    controller.signal.onabort = async () => {
                        await channel.cancel(consumerTag)
                        resolve()
                    }
                }
            })
        } finally {
            await channel.close()
        }
    })()
    return [promise, close]
}
