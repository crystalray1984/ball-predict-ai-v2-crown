import { CONFIG } from '@/config'
import axios from 'axios'

export interface ApiOptions {
    url: string
    baseURL?: string
    method?: string
    data?: any
}

export interface ApiResp<T = void> {
    code: number
    msg: string
    data: T
}

const instance = axios.create({
    baseURL: CONFIG.api_url,
    method: 'POST',
    responseType: 'json',
})

/**
 * 调用业务端接口
 * @param options
 */
export async function api<T = void>(options: ApiOptions): Promise<ApiResp<T>> {
    const resp = await instance.request<ApiResp<T>>(options)
    if (typeof resp.data === 'object' && resp.data && resp.data.code !== 0) {
        console.log('[API]', options.url)
        if (options.data) {
            console.log('[API]', JSON.stringify(options.data))
        }
        console.log('[API]', JSON.stringify(resp.data))
    }
    return resp.data
}

export interface SendUserSocketMessageData {
    type: 'uid'
    target: number | number[]
    message: Record<string, any>
}

export interface SendGroupSocketMessageData {
    type: 'group'
    target: string | string[]
    message: Record<string, any>
}

export type SendSocketMessageData = SendUserSocketMessageData | SendGroupSocketMessageData

/**
 * 发送WS消息
 */
export function sendSocketMessage(data: SendSocketMessageData) {
    return api({
        url: '/api/common/send_socket_message',
        data,
    })
}
