import { Options as RabbitmqOptions } from 'amqplib'
import { load } from 'js-yaml'
import { merge } from 'lodash'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type Options as DbOptions } from 'sequelize'
import { RedisOptions } from 'ioredis'
import { Options as PoolOptions } from 'generic-pool'

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
     * surebet抓取token
     */
    surebet_token: string
    /**
     * Luffa机器人配置
     */
    luffa: LuffaConfig
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
}

/**
 * 读取配置
 */
export const CONFIG: AppConfig = loadConfigFiles()
