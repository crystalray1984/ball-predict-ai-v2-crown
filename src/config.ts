import { Options as RabbitmqOptions } from 'amqplib'
import { load } from 'js-yaml'
import { merge } from 'lodash'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type Options as DbOptions } from 'sequelize'
import { RedisOptions } from 'ioredis'
import { Options as PoolOptions } from 'generic-pool'
import { CrownAccount } from './db'

/**
 * 当前应用的根目录
 */
export const ROOT = resolve(__dirname, '../')

/**
 * 获取配置文件列表
 */
function getConfigFiles() {
    const files = ['config.yaml', 'config.yaml.local'].map((file) => join(ROOT, file))
    return files.filter((file) => existsSync(file))
}

/**
 * 读取配置文件
 */
function loadConfigFiles(): any {
    let output = {}
    const files = getConfigFiles()
    for (const filePath of files) {
        const config = load(readFileSync(filePath, 'utf-8'))
        if (typeof config === 'object' && config) {
            output = merge(output, config)
        }
    }
    return output
}

/**
 * 应用配置
 */
export interface AppConfig {
    /**
     * 皇冠地址
     */
    crown_url: string
    /**
     * 数据库配置
     */
    db: DbOptions
    /**
     * Redis配置
     */
    redis: {
        connection: RedisOptions
        pool: PoolOptions
    }
    /**
     * 消息队列配置
     */
    rabbitmq: RabbitmqOptions.Connect
    /**
     * Luffa机器人配置
     */
    luffa: LuffaConfig
    /**
     * surebet采集配置
     */
    surebet: SurebetConfig
    /**
     * 第二surebet采集配置
     */
    surebet2: SurebetConfig
    /**
     * 队列名称
     */
    queues: Record<string, string>

    /**
     * 采集到皇冠比赛数据后要抛到的队列
     */
    crown_matches_data_queues: string[]
    /**
     * 采集到皇冠赛果数据后要抛到的队列
     */
    crown_score_data_queues: string[]
    /**
     * 机器id
     */
    machine_id: string
    /**
     * 本机测试用的皇冠账号
     */
    test_crown_account?: CrownAccount

    /**
     * WS连接地址
     */
    socket_url: string
}

/**
 * surebet抓取配置
 */
export interface SurebetConfig {
    /**
     * 采集数据的token
     */
    token: string
    /**
     * 采集到数据之后后续抛到的队列
     */
    next_queues: string[]
}

export interface LuffaAtItem {
    name: string
    did: string
}

/**
 * Luffa通知配置
 */
export interface LuffaNotificationConfig {
    /**
     * 发送的目标
     */
    uid: string
    /**
     * 目标类型 0-单聊 1-群聊
     */
    type: number
    /**
     * at列表
     */
    atList?: LuffaAtItem[]
}

/**
 * Luffa配置
 */
export interface LuffaConfig {
    uid: string
    secret: string
    notification: LuffaNotificationConfig[]
    notification_channel2: LuffaNotificationConfig[]
    surebet_v2_to_v3: LuffaNotificationConfig[]
    rockball: LuffaNotificationConfig[]
    mansion: LuffaNotificationConfig[]
}

/**
 * 读取配置
 */
export const CONFIG: AppConfig = loadConfigFiles()
