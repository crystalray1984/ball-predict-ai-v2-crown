import { Queue } from './queue'

/**
 * 限制了执行频率的队列
 */
export class RateLimiter {
    /**
     * 允许执行下一个任务的时间
     */
    protected nextRunTime = 0

    protected queue: Queue

    /**
     *
     * @param interval 两次任务之间的执行间隔
     */
    constructor(protected interval: number) {
        this.queue = new Queue(1)
    }

    protected add<T>(task: () => Promise<T> | T): Promise<T> {
        //对任务进行封装
        const wrappedTask = async (): Promise<T> => {
            const now = Date.now()
            if (now < this.nextRunTime) {
                await new Promise<void>((resolve) => setTimeout(resolve, this.nextRunTime - now))
            }
            this.nextRunTime = Date.now() + this.interval
            return task()
        }

        return this.queue.add(wrappedTask)
    }

    /**
     * 返回一个快捷等待任务
     */
    next() {
        return this.add(() => {})
    }
}
