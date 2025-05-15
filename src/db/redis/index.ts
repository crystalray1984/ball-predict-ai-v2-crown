import { CONFIG } from '@/config'
import { Pool } from './pool'

/**
 * Redis连接池
 */
export const redis = new Pool(CONFIG.redis.connection, CONFIG.redis.pool)
