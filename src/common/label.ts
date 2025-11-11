import { redis, TournamentLabel } from '@/db'
import { InferAttributes } from 'sequelize'

/**
 * 系统配置的Redis缓存键名
 */
export const CACHE_LABELS_KEY = 'tournament_labels'

/**
 * 获取标签信息
 * @param label_id
 * @returns
 */
export async function getLabelInfo(
    label_id: number,
): Promise<InferAttributes<TournamentLabel> | undefined> {
    if (await redis.exists(CACHE_LABELS_KEY)) {
        const cache = await redis.hget(CACHE_LABELS_KEY, label_id.toString())
        return cache ? JSON.parse(cache) : undefined
    } else {
        const data = await refreshLabels()
        return data[label_id.toString()]
    }
}

/**
 * 重构标签数据缓存
 */
async function refreshLabels() {
    const rows = await TournamentLabel.findAll()
    const cacheData = Object.fromEntries(
        rows.map((row) => [row.id.toString(), JSON.stringify(row)]),
    )
    const client = await redis.multi()
    await client.del(CACHE_LABELS_KEY).hmset(CACHE_LABELS_KEY, cacheData).exec()

    return Object.fromEntries(rows.map((row) => [row.id.toString(), row]))
}
