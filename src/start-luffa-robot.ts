import { runLoop } from '@/common/helpers'
import { LuffaMessage, receiveMsg } from '@/common/luffa'
import { LuffaUser } from './db'

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
                await LuffaUser.create(
                    {
                        uid: group.uid,
                        type: group.type,
                        open_push: 1,
                    },
                    { ignoreDuplicates: true, returning: false },
                )
            } catch (err) {
                console.error(err)
            }
        }
    }
}

/**
 * 监听要通过luffa发送的消息队列
 */
async function startLuffaSenderQueue() {}

if (require.main === module) {
    runLoop(1000, receiveLuffaMsg)
}
