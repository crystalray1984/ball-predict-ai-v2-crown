import { QueueConfig } from './rabbitmq'

/**
 * 皇冠采集队列定义
 */
export const CROWN_ODD_QUEUE: QueueConfig = {
    name: 'crown_odd',
    assert: {
        maxPriority: 20,
    },
}
