const _singletons: Record<string | symbol, () => any> = {}

/**
 * 执行一项单例任务
 * @param name 任务名称
 * @param task 任务执行方法
 */
export function singleton<T>(name: string | symbol, task: () => T): T {
    if (typeof _singletons[name] === 'function') {
        return _singletons[name]()
    }

    const result = task()
    if (result instanceof Promise) {
        _singletons[name] = () => result
        result.finally(() => {
            delete _singletons[name]
        })
    }

    return result
}

/**
 * 返回一个等待特定时间的Promise
 * @param timeout
 * @returns
 */
export function delay(timeout: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, timeout))
}

/**
 * 队列中的任务
 */
type QueuedTask = (onComplete: () => void) => void

/**
 * 任务队列
 */
export class Queue {
    /**
     * 等待执行的队列任务
     */
    protected waiting: QueuedTask[] = []
    /**
     * 执行中的队列任务
     */
    protected running: QueuedTask[] = []
    /**
     * 创建一个任务队列
     * @param concurrent 允许同时并发执行的任务数
     */
    constructor(public concurrent = 1) {}

    /**
     * 添加一个任务到队列中
     * @param task
     */
    add<T>(task: () => Promise<T> | T): Promise<T> {
        let resolver: (value: T | PromiseLike<T>) => void
        let rejecter: (err?: any) => void
        const promise = new Promise<T>((resolve, reject) => {
            resolver = resolve
            rejecter = reject
        })
        const queued: QueuedTask = async (onComplete) => {
            try {
                resolver(await task())
            } catch (err) {
                rejecter(err)
            } finally {
                onComplete()
            }
        }

        this.waiting.push(queued)
        setTimeout(() => this.next(), 0)

        return promise
    }

    /**
     * 尝试执行下一个任务
     */
    protected next() {
        if (this.running.length >= this.concurrent) return
        const task = this.waiting.shift()
        if (!task) return
        this.running.push(task)
        task(() => {
            const index = this.running.indexOf(task)
            if (index !== -1) {
                this.running.splice(index, 1)
            }
            setTimeout(() => this.next(), 0)
        })
    }
}

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
    constructor(public interval: number) {
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
