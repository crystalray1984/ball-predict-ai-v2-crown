import { Options as RabbitmqOptions } from 'amqplib'
import { load } from 'js-yaml'
import { merge } from 'lodash'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type Options as DbOptions } from 'sequelize'

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
     * 消息队列配置
     */
    rabbitmq: RabbitmqOptions.Connect
}

/**
 * 读取配置
 */
export const CONFIG: AppConfig = loadConfigFiles()
