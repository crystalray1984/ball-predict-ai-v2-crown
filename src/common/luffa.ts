import { CONFIG } from '@/config'
import axios from 'axios'

/**
 * 执行Luffa请求
 */
async function request<T = void>(
    url: string,
    data: any = undefined,
    responseType: 'text' | 'json' = 'text',
) {
    const resp = await axios.request<T>({
        url,
        baseURL: 'https://apibot.luffa.im',
        method: 'POST',
        timeout: 10000,
        responseType,
        data,
    })
    return resp.data
}

/**
 * 发送Luffa消息给个人
 * @param uid 发送到的目标uid
 * @param text 发送的内容
 */
export function sendSingleMsg(uid: string, text: string) {
    return request('/robot/send', {
        secret: CONFIG.luffa.secret,
        uid,
        msg: JSON.stringify({ text }),
    })
}

/**
 * 发送Luffa消息到群
 * @param uid 群id
 * @param type 消息类型
 * @param msg 消息体
 */
export function sendGroupMsg(uid: string, text: string): Promise<void>
/**
 * 发送Luffa消息到群
 * @param uid 群id
 * @param type 消息类型
 * @param msg 消息体
 */
export function sendGroupMsg(uid: string, type: number, msg: Object): Promise<void>
export function sendGroupMsg(uid: string, arg2: number | string, msg?: Object) {
    let type: number, msgText: string
    if (typeof arg2 === 'string') {
        type = 1
        msgText = JSON.stringify({ text: arg2 })
    } else {
        type = arg2
        msgText = JSON.stringify(msg)
    }
    return request('/robot/sendGroup', {
        secret: CONFIG.luffa.secret,
        uid,
        type: type.toString(),
        msg: msgText,
    })
}

/**
 * 发送通知消息
 */
export async function sendNotification(text: string) {
    //构建通知消息
    for (const target of CONFIG.luffa.notification) {
        if (target.type === 0) {
            //单聊通知
            await sendSingleMsg(target.uid, text)
        } else if (target.type === 1) {
            //群聊通知
            const msg: Record<string, any> = {
                text,
            }

            if (target.atList && target.atList.length > 0) {
                msg.text += '\n\n'

                msg.atList = []

                for (const at of target.atList) {
                    msg.text = `${msg.text} `
                    const textAppend = `@${at.name}`

                    const atItem = {
                        name: at.name,
                        did: at.did,
                        location: msg.text.length,
                        length: textAppend.length + 1,
                        userType: '0',
                    }

                    msg.text = `${msg.text} ${textAppend} `
                    msg.atList.push(atItem)
                }
            }

            await sendGroupMsg(target.uid, 1, msg)
        }
    }
}

// if (require.main === module) {
//     sendNotification('**测试消息**\n\n机器人账号已经失效，请立即处理')
// }
