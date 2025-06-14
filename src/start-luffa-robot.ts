import { runLoop } from '@/common/helpers'
import { receiveMsg } from '@/common/luffa'

/**
 * 接收来自Luffa的消息
 */
async function receiveLuffaMsg() {
    const groups = await receiveMsg()

    if (!Array.isArray(groups) || groups.length === 0) {
        return
    }

    for (const group of groups) {
        //解析消息内容
        const messages = group.message.map((str) => JSON.parse(str))
        //打印消息内容
        console.log({
            ...group,
            message: messages,
        })
    }
}

/**
 * 监听要通过luffa发送的消息队列
 */
async function startLuffaSenderQueue() {}

if (require.main === module) {
    runLoop(60000, receiveLuffaMsg)
}
