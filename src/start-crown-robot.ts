import dayjs from 'dayjs'
import { CROWN_ODD_QUEUE } from './common/constants'
import * as rabbitmq from './common/rabbitmq'
import { CONFIG } from './config'
import { getCrownData, getCrownMatches, getCrownScore, init, reset } from './crown'
import { getHotMatches, getTodayMatches } from './crown/match'
import { getSpeeds } from './start-crown-speed'

/**
 * 处理从消费队列中来的皇冠盘口抓取请求
 */
export async function processCrownRequest(content: string) {
    const { next, crown_match_id, extra, show_type } = JSON.parse(content) as CrownRobot.Input

    //读取皇冠的盘口
    const data = await getCrownData(crown_match_id, show_type === 'live' ? 'live' : 'today')

    //抛到下一个队列
    await rabbitmq.publish(
        next,
        JSON.stringify({
            crown_match_id,
            extra,
            data,
        }),
    )
}

/**
 * 开启执行比赛列表抓取
 */
async function startCrownMatches() {
    //每半个小时抓取一次
    const matches = await getCrownMatches()

    console.log('采集到比赛数据', matches.length)

    //把数据抛到队列中
    const data = JSON.stringify(matches)

    for (const queue of CONFIG.crown_matches_data_queues) {
        await rabbitmq.publish(queue, data)
    }

    const todayMatches = await getTodayMatches()
    //把数据抛到队列中
    const todayData = JSON.stringify(todayMatches)

    for (const queue of CONFIG.crown_matches_data_queues) {
        await rabbitmq.publish(queue, todayData)
    }

    await startI18n()
}

const LANGUAGES: Crown.Language[] = ['en-us', 'zh-tw']

/**
 * 采集多语言数据
 */
async function startI18n() {
    for (const langx of LANGUAGES) {
        const teams: Record<string, string> = {}
        const tournaments: Record<string, string> = {}

        /**
         * 从比赛数据中解析赛事和队伍数据
         * @param matches
         */
        const parseMatches = (matches: Crown.MatchInfo[]) => {
            matches.forEach((match) => {
                tournaments[match.lid] = match.league
                teams[match.team_id_h] = match.team_h
                teams[match.team_id_c] = match.team_c
            })
        }

        //采集早盘比赛数据
        parseMatches(await getCrownMatches(langx))
        //采集今日比赛数据
        parseMatches(await getTodayMatches(langx))
        //抛到更新队列
        const data = {
            teams: Object.entries(teams).map(([id, name]) => ({ id, name })),
            tournaments: Object.entries(tournaments).map(([id, name]) => ({ id, name })),
            lang: langx.split('-')[0],
        }

        await rabbitmq.publish('i18n_data', JSON.stringify(data))
    }
}

/**
 * 执行皇冠赛果抓取
 */
async function startCrownScore() {
    if (
        !Array.isArray(CONFIG.crown_score_data_queues) ||
        CONFIG.crown_score_data_queues.length === 0
    )
        return

    const today = dayjs().startOf('day')
    const hour = dayjs().hour()

    //读取今天的赛程列表
    let scores: Crown.ScoreInfo[] = []
    try {
        const list = await getCrownScore(today.format('YYYY-MM-DD'))
        if (list.length > 0) {
            scores = scores.concat(list)
        }
    } catch {}

    if (hour <= 14) {
        //读取昨天的赛程列表
        try {
            const list = await getCrownScore(today.subtract(1, 'day').format('YYYY-MM-DD'))
            if (list.length > 0) {
                scores = scores.concat(list)
            }
        } catch {}
    }

    if (scores.length > 0) {
        //抛到其他队列完成赛果更新
        const data = JSON.stringify(scores)

        for (const queue of CONFIG.crown_score_data_queues) {
            await rabbitmq.publish(queue, data)
        }
    }
}

/**
 * 执行热门比赛采集
 */
async function startHotMatches() {
    //每半个小时抓取一次
    const matches = await getHotMatches()

    console.log('采集到热门比赛数据', matches.length)

    //把数据抛到队列中
    const data = JSON.stringify(matches)
    await rabbitmq.publish('crown_hot_matches', data)
}

let matchTimer = undefined as any
let scoreTimer = undefined as any
let hotTimer = undefined as any

/**
 * 开启皇冠采集进程
 */
async function startCrownRobot() {
    console.log('采集皇冠比赛', !!process.env.CROWN_MATCHES)
    console.log('采集皇冠赛果', !!process.env.CROWN_SCORE)
    console.log('采集皇冠热门比赛', !!process.env.CROWN_HOT)

    //测速
    if (!CONFIG.crown_url) {
        const speeds = await getSpeeds()
        speeds.sort((site1, site2) => {
            let fail1 = site1.speed.fail > 1 ? site1.speed.fail : 0
            let fail2 = site2.speed.fail > 1 ? site2.speed.fail : 0
            if (fail1 !== fail2) {
                return fail1 - fail2
            }
            return site1.speed.speed - site2.speed.speed
        })

        console.log('测速结果')
        speeds.forEach((item) => console.log(item))

        //设置网址
        if (speeds.length > 0) {
            CONFIG.crown_url = speeds[0].url
        }
    }

    while (true) {
        try {
            await init()

            if (process.env.CROWN_MATCHES) {
                startCrownMatches()
                matchTimer = setInterval(startCrownMatches, 600000)
            }
            if (process.env.CROWN_SCORE) {
                scoreTimer = setInterval(startCrownScore, 60000)
            }
            if (process.env.CROWN_HOT) {
                hotTimer = setInterval(startHotMatches, 60000)
            }

            let errors = 0
            const [promise, close] = rabbitmq.consume(CROWN_ODD_QUEUE, async (content) => {
                try {
                    await processCrownRequest(content)
                } catch {
                    errors++
                    if (errors > 10) {
                        //累计失败10次后重启
                        close()
                    }
                }
            })
            await promise
        } finally {
            clearInterval(matchTimer)
            clearInterval(scoreTimer)
            clearInterval(hotTimer)

            await reset()
            await rabbitmq.close()
        }
    }
}

if (require.main === module) {
    startCrownRobot()
}
