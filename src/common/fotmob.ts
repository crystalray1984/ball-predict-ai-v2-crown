import { Match, VMatch } from '@/db'
import axios from 'axios'
import { RateLimiter } from './rate-limiter'
import dayjs from 'dayjs'
import levenshtein from 'js-levenshtein'
import { USER_AGENT } from '@/titan007/base'

/**
 * 抓取频率限制器
 */
export const fotmobLimiter = new RateLimiter(1000)

/**
 * 查询fotmob详情接口
 * @param matchId Fotmob比赛id
 */
export async function getMatchDetails(
    matchId: string,
): Promise<Pick<Match, 'score1' | 'score2' | 'score1_period1' | 'score2_period1'> | undefined> {
    await fotmobLimiter.next()
    const resp = await axios.request<Fotmob.MatchDetails>({
        url: `https://www.fotmob.com/api/data/matchDetails`,
        params: {
            matchId,
        },
        headers: {
            Referer: 'https://www.fotmob.com/',
            'User-Agent': USER_AGENT,
        },
    })

    const result: Pick<Match, 'score1' | 'score2' | 'score1_period1' | 'score2_period1'> = {
        score1: null,
        score2: null,
        score1_period1: null,
        score2_period1: null,
    }

    if (resp.data.error) return
    if (!resp.data.header.status.halfs.firstHalfEnded) return

    //读取上半场比分数据
    const period1Event = resp.data.content.matchFacts.events.events.find(
        (t) => t.type === 'Half' && t.halfStrKey === 'halftime_short',
    )
    if (!period1Event) return
    result.score1_period1 = period1Event.homeScore
    result.score2_period1 = period1Event.awayScore

    //读取全场比分
    const event = resp.data.content.matchFacts.events.events.find(
        (t) => t.type === 'Half' && t.halfStrKey === 'fulltime_short',
    )
    if (event) {
        //有全场比分
        result.score1 = event.homeScore
        result.score2 = event.awayScore
    }
    return result
}

/**
 * 查询fotmob比赛列表
 * @param date YYYYMMDD格式的日期
 */
export async function getMatches(date: string) {
    await fotmobLimiter.next()
    const resp = await axios.request<{
        leagues: Fotmob.League[]
    }>({
        url: `https://www.fotmob.com/api/data/matches`,
        params: {
            date,
            timezone: 'Asia/Shanghai',
            ccode3: 'ENG',
        },
        headers: {
            Referer: 'https://www.fotmob.com/',
            'User-Agent': USER_AGENT,
        },
    })

    //整理数据
    return resp.data.leagues
        .map((league) =>
            league.matches.map((match) => {
                match.status.time = dayjs(match.status.utcTime).valueOf()
                return match
            }),
        )
        .flat()
}

interface FindMatchResult {
    match_id: string
    swap: number
    team1_id: string
    team2_id: string
    started: boolean
}

/**
 * 寻找匹配的比赛
 * @param team1_name
 * @param team2_name
 * @param matches
 */
export function findMatch(
    match: Pick<
        VMatch,
        'match_time' | 'team1_name' | 'team2_name' | 'team1_fotmob_id' | 'team2_fotmob_id'
    >,
    source: Fotmob.Match[],
): FindMatchResult | undefined {
    const team1_name = match.team1_name.replace(/[^a-z]/gi, '')
    const team2_name = match.team2_name.replace(/[^a-z]/gi, '')
    const match_time = match.match_time.valueOf()

    //先过滤掉比赛时间相差太大的比赛
    source = source.filter((row) => Math.abs(row.status.time - match_time) <= 900000)

    //先寻找完全匹配的数据
    let found = source.find((row) => {
        if (match.team1_fotmob_id) {
            if (match.team1_fotmob_id === row.home.id.toString()) return true
        }
        if (match.team2_fotmob_id) {
            if (match.team2_fotmob_id === row.away.id.toString()) return true
        }
        return (
            team1_name === row.home.name ||
            team2_name === row.home.longName ||
            team2_name === row.away.name ||
            team2_name === row.away.longName
        )
    })

    if (found) {
        return {
            match_id: found.id.toString(),
            team1_id: found.home.id.toString(),
            team2_id: found.away.id.toString(),
            started: found.status.started,
            swap: 0,
        }
    }

    //再寻找高度相似的数据
    found = source.find((row) => {
        let team1_level = Math.min(
            Math.max(Math.floor(Math.min(team1_name.length, row.home.longName.length) / 3), 1),
            2,
        )
        let team2_level = Math.min(
            Math.max(Math.floor(Math.min(team2_name.length, row.away.longName.length) / 3), 1),
            2,
        )
        const team1_match = (() => {
            const value = levenshtein(team1_name, row.home.longName)
            if (value <= team1_level) {
                return true
            }
            return false
        })()
        const team2_match = (() => {
            const value = levenshtein(team2_name, row.away.longName)
            if (value <= team2_level) {
                return true
            }
            return false
        })()
        if (!team1_match && !team2_match) return false
        return true
    })

    if (!found) {
        //通过简写名称判断相似
        found = source.find((row) => {
            let team1_level = Math.min(
                Math.max(Math.floor(Math.min(team1_name.length, row.home.name.length) / 3), 1),
                2,
            )
            let team2_level = Math.min(
                Math.max(Math.floor(Math.min(team2_name.length, row.away.name.length) / 3), 1),
                2,
            )
            const team1_match = (() => {
                const value = levenshtein(team1_name, row.home.name)
                if (value <= team1_level) {
                    return true
                }
                return false
            })()
            const team2_match = (() => {
                const value = levenshtein(team2_name, row.away.name)
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
            match_id: found.id.toString(),
            team1_id: found.home.id.toString(),
            team2_id: found.away.id.toString(),
            started: found.status.started,
            swap: 0,
        }
    }

    //尝试交换队伍名称
    //先寻找完全匹配的数据
    found = source.find((row) => {
        if (match.team1_fotmob_id) {
            if (match.team1_fotmob_id === row.away.id.toString()) return true
        }
        if (match.team2_fotmob_id) {
            if (match.team2_fotmob_id === row.home.id.toString()) return true
        }
        return (
            team1_name === row.away.name ||
            team2_name === row.away.longName ||
            team2_name === row.home.name ||
            team2_name === row.home.longName
        )
    })

    if (found) {
        return {
            match_id: found.id.toString(),
            team1_id: found.away.id.toString(),
            team2_id: found.home.id.toString(),
            started: found.status.started,
            swap: 1,
        }
    }

    //再寻找高度相似的数据
    found = source.find((row) => {
        let team1_level = Math.min(
            Math.max(Math.floor(Math.min(team1_name.length, row.away.longName.length) / 3), 1),
            2,
        )
        let team2_level = Math.min(
            Math.max(Math.floor(Math.min(team2_name.length, row.home.longName.length) / 3), 1),
            2,
        )
        const team1_match = (() => {
            const value = levenshtein(team1_name, row.away.longName)
            if (value <= team1_level) {
                return true
            }
            return false
        })()
        const team2_match = (() => {
            const value = levenshtein(team2_name, row.home.longName)
            if (value <= team2_level) {
                return true
            }
            return false
        })()
        if (!team1_match && !team2_match) return false
        return true
    })

    if (!found) {
        //通过简写名称判断相似
        found = source.find((row) => {
            let team1_level = Math.min(
                Math.max(Math.floor(Math.min(team1_name.length, row.away.name.length) / 3), 1),
                2,
            )
            let team2_level = Math.min(
                Math.max(Math.floor(Math.min(team2_name.length, row.home.name.length) / 3), 1),
                2,
            )
            const team1_match = (() => {
                const value = levenshtein(team1_name, row.away.name)
                if (value <= team1_level) {
                    return true
                }
                return false
            })()
            const team2_match = (() => {
                const value = levenshtein(team2_name, row.home.name)
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
            match_id: found.id.toString(),
            team1_id: found.away.id.toString(),
            team2_id: found.home.id.toString(),
            started: found.status.started,
            swap: 1,
        }
    }
}
