import { CONFIG } from '@/config'
import axios, { AxiosRequestConfig } from 'axios'

/**
 * 机器人接收到的Luffa消息
 */
export interface LuffaMessage {
    uid: string
    text: string
    [name: string]: any
}

/**
 * 机器人接收到的单个Luffa消息组
 */
export interface LuffaMessageGroup {
    uid: string
    count: number
    type: number
    message: string[]
}

/**
 * 执行Luffa请求
 */
async function request<T = void>(
    url: string,
    data: any = undefined,
    responseType: 'text' | 'json' = 'text',
    options: AxiosRequestConfig = {},
) {
    const resp = await axios.request<T>({
        ...options,
        url,
        baseURL: 'https://apibot.luffa.im',
        method: 'POST',
        timeout: 3000,
        responseType,
        data,
        headers: {
            'Content-Type': 'application/json',
        },
    })
    return resp.data
}

/**
 * 发送Luffa消息给个人
 * @param uid 发送到的目标uid
 * @param text 发送的内容
 */
export function sendSingleMsg(uid: string, text: string, options?: AxiosRequestConfig) {
    return request<string>(
        '/robot/send',
        {
            secret: CONFIG.luffa.secret,
            uid,
            msg: JSON.stringify({ text }),
        },
        'text',
        options,
    )
}

/**
 * 发送Luffa消息到群
 * @param uid 群id
 * @param type 消息类型
 * @param msg 消息体
 */
export function sendGroupMsg(uid: string, text: string): Promise<string>
/**
 * 发送Luffa消息到群
 * @param uid 群id
 * @param type 消息类型
 * @param msg 消息体
 */
export function sendGroupMsg(uid: string, type: number, msg: Object): Promise<string>
export function sendGroupMsg(uid: string, arg2: number | string, msg?: Object) {
    let type: number, msgText: string
    if (typeof arg2 === 'string') {
        type = 1
        msgText = JSON.stringify({ text: arg2 })
    } else {
        type = arg2
        msgText = JSON.stringify(msg)
    }
    return request<string>(
        '/robot/sendGroup',
        {
            secret: CONFIG.luffa.secret,
            uid,
            type: type.toString(),
            msg: msgText,
        },
        'text',
    )
}

/**
 * 发送通知消息
 */
export async function sendNotification(text: string) {
    //构建通知消息
    for (const target of CONFIG.luffa.notification) {
        if (target.type === 0) {
            //单聊通知
            const resp = await sendSingleMsg(target.uid, text)
            console.log(resp)
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

            const resp = await sendGroupMsg(target.uid, 1, msg)
            console.log(resp)
        }
    }
}

/**
 * 接收用户发送给Luffa机器人的消息
 */
export function receiveMsg() {
    return request<LuffaMessageGroup[]>(
        '/robot/receive',
        {
            secret: CONFIG.luffa.secret,
        },
        'json',
    )
}

// if (require.main === module) {
//     sendSingleMsg('fysgcHNkS5w', '**测试消息**\n\n机器人账号已经失效，请立即处理')
//         .then((resp) => {
//             console.log(resp)
//         })
//         .finally(() => process.exit())
// }
