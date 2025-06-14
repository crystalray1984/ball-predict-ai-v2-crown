import { runLoop } from '@/common/helpers'
import { LuffaMessage, receiveMsg } from '@/common/luffa'
import { close, consume } from '@/common/rabbitmq'
import { LuffaUser } from '@/db'

/**
 * 接收来自Luffa的消息
 */
async function receiveLuffaMsg() {
    const groups = await receiveMsg()

    if (!Array.isArray(groups) || groups.length === 0) {
        return
    }

    for (const group of groups) {
        if (group.type === 0) {
            //是普通用户
            try {
                await LuffaUser.findOrCreate({
                    where: {
                        uid: group.uid,
                    },
                    defaults: {
                        uid: group.uid,
                        type: group.type,
                        open_push: 1,
                    },
                    attributes: ['uid'],
                })
            } catch (err) {
                console.error(err)
            }

            const messages = group.message.map<LuffaMessage>((str) => JSON.parse(str))

            //判断有没有新关注的消息
        }
    }
}

/**
 * 监听需要发送到luffa的消息
 */
async function processLuffaSendMessage() {}

/**
 * 监听要通过luffa发送的消息队列
 */
async function startLuffaMessageQueue() {
    while (true) {
        const [promise] = consume('ready_check_after', processLuffaSendMessage, {
            prefetchCount: 5,
        })
        await promise
        await close()
    }
}

if (require.main === module) {
    runLoop(1000, receiveLuffaMsg)
    // startLuffaMessageQueue()
}
