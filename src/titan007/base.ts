import { RateLimiter } from '@/common/rate-limiter'
import { VMatch } from '@/db'
import axios from 'axios'
import { load } from 'cheerio'
import { decode } from 'iconv-lite'
import levenshtein from 'js-levenshtein'

/**
 * 抓取频率限制器
 */
export const titan007Limiter = new RateLimiter(1000)

/**
 * 浏览器UA
 */
export const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0'

/**
 * 加载页面
 * @param url
 * @param params
 * @param charset
 * @returns
 */
export async function loadDoc(url: string, params?: Record<string, any>, charset?: string) {
    await titan007Limiter.next()
    const resp = await axios.request<Buffer>({
        url,
        params,
        method: 'GET',
        responseType: 'arraybuffer',
        headers: {
            Referer: 'https://live.titan007.com/oldIndexall.aspx',
            'User-Agent': USER_AGENT,
        },
    })

    let html: string

    if (charset) {
        //需要做编码转换
        html = decode(resp.data, 'GBK')
    } else {
        html = resp.data.toString('utf-8')
    }

    return load(html)
}

/**
 * 球探网比赛匹配后的数据
 */
export interface FindMatchResult extends Titan007.TodayMatchInfo {
    /**
     * 是否主客场对调
     */
    swap: boolean
}

/**
 * 寻找球探网比赛
 */
export function findMatch(
    match: Pick<VMatch, 'match_time' | 'team1_name' | 'team2_name'> &
        Partial<Pick<VMatch, 'team1_titan007_id' | 'team2_titan007_id'>>,
    source: Titan007.TodayMatchInfo[],
): FindMatchResult | void {
    const team1_name = match.team1_name.replace(/[()（）]|\s/g, '')
    const team2_name = match.team2_name.replace(/[()（）]|\s/g, '')
    const match_time = match.match_time.valueOf()

    //先过滤掉比赛时间相差太大的比赛
    source = source.filter((row) => Math.abs(row.match_time - match_time) <= 900000)

    //先寻找完全匹配的数据
    let found = source.find((row) => {
        if (match.team1_titan007_id) {
            if (match.team1_titan007_id === row.team1_id) return true
        }
        if (match.team2_titan007_id) {
            if (match.team2_titan007_id === row.team2_id) return true
        }
        return team1_name === row.team1 || team2_name === row.team2
    })

    if (!found) {
        //再寻找高度相似的队伍
        found = source.find((row) => {
            let team1_level = Math.min(
                Math.max(Math.floor(Math.min(team1_name.length, row.team1.length) / 3), 1),
                2,
            )
            let team2_level = Math.min(
                Math.max(Math.floor(Math.min(team2_name.length, row.team2.length) / 3), 1),
                2,
            )
            const team1_match = (() => {
                const value = levenshtein(team1_name, row.team1)
                if (value <= team1_level) {
                    return true
                }
                return false
            })()
            const team2_match = (() => {
                const value = levenshtein(team2_name, row.team2)
                if (value <= team2_level) {
                    return true
                }
                return false
            })()
            if (!team1_match && !team2_match) return false
            return true
        })
    }

    if (found) {
        return {
            ...found,
            swap: false,
        }
    }

    //尝试反向寻找数据

    //先寻找完全匹配的数据
    found = source.find((row) => {
        if (match.team1_titan007_id) {
            if (match.team1_titan007_id === row.team2_id) return true
        }
        if (match.team2_titan007_id) {
            if (match.team2_titan007_id === row.team1_id) return true
        }
        return team1_name === row.team2 || team2_name === row.team1
    })

    if (!found) {
        //再寻找高度相似的队伍
        found = source.find((row) => {
            let team1_level = Math.min(
                Math.max(Math.floor(Math.min(team1_name.length, row.team2.length) / 3), 1),
                2,
            )
            let team2_level = Math.min(
                Math.max(Math.floor(Math.min(team2_name.length, row.team1.length) / 3), 1),
                2,
            )
            const team1_match = (() => {
                const value = levenshtein(team1_name, row.team2)
                if (value <= team1_level) {
                    return true
                }
                return false
            })()
            const team2_match = (() => {
                const value = levenshtein(team2_name, row.team1)
                if (value <= team2_level) {
                    return true
                }
                return false
            })()
            if (!team1_match && !team2_match) return false
            return true
        })
    }

    if (found) {
        return {
            ...found,
            swap: true,
        }
    }
}
