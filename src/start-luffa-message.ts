import { runLoop } from '@/common/helpers'
import {
    LuffaMessage,
    LuffaMessageGroup,
    receiveMsg,
    sendGroupMsg,
    sendSingleMsg,
} from '@/common/luffa'
import { close, consume, publish } from '@/common/rabbitmq'
import { LuffaUser } from '@/db'

/**
 * 接收来自Luffa的消息
 */
async function receiveLuffaMsg() {
    let groups: LuffaMessageGroup[]
    try {
        groups = await receiveMsg()
    } catch {
        return
    }

    if (!Array.isArray(groups) || groups.length === 0) {
        return
    }

    for (const group of groups) {
        //不管是普通用户还是群组，都记录到数据库
        try {
            await LuffaUser.create(
                {
                    uid: group.uid,
                    type: group.type as 0 | 1,
                },
                { ignoreDuplicates: true, returning: false },
            )
        } catch {}

        if (group.type === 0) {
            const messages = group.message.map<LuffaMessage>((str) => JSON.parse(str))

            //判断有没有新关注的消息
            if (messages.some((t) => typeof t.name === 'string')) {
                //新关注的用户
                await publish(
                    'send_luffa_message',
                    JSON.stringify({
                        uid: group.uid,
                        is_group: false,
                        msg: {
                            text: `你好！我是BallPredictAI⚽️
为你带来“AI精准分析”的足球赛事推荐！
赛前3分钟推送关键预测消息。
订阅会员，即刻接收赛事推荐！
https://callup.luffa.im/superbox/mpy0grtc2k7x68fx`,
                        },
                    }),
                )
            }
        } else {
            //群消息，记录日志
            const messages = group.message.map<LuffaMessage>((str) => JSON.parse(str))
            console.log('收到群消息', messages)
        }
    }
}

/**
 * 监听需要发送到luffa的消息
 */
async function processLuffaSendMessage(content: string) {
    try {
        const message: {
            uid: string
            is_group: boolean
            msg: Record<string, any>
            msg_type: number
        } = JSON.parse(content)

        console.log('发送消息到Luffa', message)

        //发送消息
        let resp: string
        if (message.is_group) {
            //发送群聊消息
            resp = await sendGroupMsg(message.uid, message.msg_type, message.msg)
        } else {
            //发送单聊消息
            resp = await sendSingleMsg(message.uid, message.msg.text)
        }

        console.log(resp)
    } catch (err) {
        console.error('发送Luffa消息异常', content)
        console.error(err)
        throw err
    }
}

/**
 * 监听要通过luffa发送的消息队列
 */
async function startLuffaMessageQueue() {
    while (true) {
        const [promise] = consume('send_luffa_message', processLuffaSendMessage, {
            prefetchCount: 5,
        })
        await promise
        await close()
    }
}

if (require.main === module) {
    runLoop(1000, receiveLuffaMsg)
    startLuffaMessageQueue()
}
