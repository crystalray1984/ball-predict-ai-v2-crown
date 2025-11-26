import { CONFIG } from '@/config'
import { machineIdSync } from 'node-machine-id'
import { URL } from 'node:url'
import { isArrayBuffer } from 'node:util/types'
import { WebSocket } from 'ws'
import { getMachineId } from './helpers'

const listeners: Record<string, Function[]> = {}

/**
 * 监听特定类型的socket推送消息
 */
export function registerSocketListener<T extends Socket.IncomingMessage>(
    type: T['type'],
    listener: (message: T) => void,
): void
// /**
//  * 监听特定类型的socket推送消息
//  */
// export function registerSocketListener(
//     type: string,
//     listener: (message: Socket.IncomingMessage) => void,
// ): void
/**
 * 监听所有socket推送消息
 */
export function registerSocketListener(listener: (message: Socket.IncomingMessage) => void): void
export function registerSocketListener(arg1: string | Function, arg2?: Function): void {
    let type: string, listener: Function
    if (typeof arg1 === 'string') {
        type = arg1
        listener = arg2!
    } else {
        type = '*'
        listener = arg1
    }

    if (Array.isArray(listeners[type])) {
        listeners[type].push(listener)
    } else {
        listeners[type] = [listener]
    }
}

let serviceType = ''

export function setServiceType(type: string): void {
    serviceType = type
}

let socket = null as unknown as WebSocket

/**
 * 在连接中断时待发送的消息
 */
let unsentMessages: Socket.Message<string>[] = []

/**
 * 开启socket连接
 */
export function start() {
    if (socket && socket.readyState !== WebSocket.CLOSED) return
    connect()
}

/**
 * 关闭ws连接
 */
export function close() {
    if (!socket || socket.readyState === WebSocket.CLOSED) return
    socket.close()
}

function connect() {
    //构建连接地址
    const url = new URL(CONFIG.socket_url)
    url.searchParams.append('type', 'service')
    if (serviceType) {
        url.searchParams.append('service_type', serviceType)
    }
    url.searchParams.append('service_id', getMachineId())
    socket = new WebSocket(url)

    socket.on('open', () => {
        console.log('[SOCKET]', `已连接 ${url.href}`)

        //发送之前未发送的消息
        if (unsentMessages.length > 0) {
            const list = unsentMessages.splice(0, unsentMessages.length)
            list.forEach((message) => socket.send(JSON.stringify(message)))
        }
    })

    socket.on('error', (err) => {
        console.log('[SOCKET]', err)
        //3秒后自动连接
        setTimeout(connect, 3000)
    })

    socket.on('close', (code, reason) => {
        console.log('[SOCKET]', `连接关闭`, code, reason.toString('utf-8'))
        socket = null as any
    })

    socket.on('message', (data) => {
        let buffer: Buffer
        if (isArrayBuffer(data)) {
            buffer = Buffer.from(data)
        } else if (Buffer.isBuffer(data)) {
            buffer = data
        } else if (Array.isArray(data)) {
            buffer = Buffer.concat(data)
        } else {
            return
        }

        const str = buffer.toString('utf-8')
        let msg: Socket.IncomingMessage
        try {
            msg = JSON.parse(str)
        } catch {
            return
        }
        if (msg.type === 'pong') return

        if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong' }))
            return
        }

        console.log('[SOCKET]', str)

        //触发消息回调
        if (Array.isArray(listeners['*'])) {
            listeners['*'].forEach((listener) => {
                try {
                    listener(msg)
                } catch (err) {
                    console.error(err)
                }
            })
        }
        if (Array.isArray(listeners[msg.type])) {
            listeners[msg.type].forEach((listener) => {
                try {
                    listener(msg)
                } catch (err) {
                    console.error(err)
                }
            })
        }
    })
}

/**
 * 通过ws发送消息
 * @param message
 */
export function send(message: Socket.Message<string>): Promise<void> {
    if (socket) {
        return new Promise((resolve, reject) => {
            socket.send(JSON.stringify(message), (err) => {
                if (err) {
                    reject(err)
                } else {
                    resolve()
                }
            })
        })
    } else {
        unsentMessages.push(message)
        return Promise.resolve()
    }
}
