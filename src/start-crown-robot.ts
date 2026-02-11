import dayjs from 'dayjs'
import * as rabbitmq from './common/rabbitmq'
import * as socket from './common/socket'
import { CONFIG } from './config'
import { getCrownData, getCrownMatches, getCrownScore, init, reset } from './crown'
import { getTodayMatches } from './crown/match'

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

let matchTimer = undefined as any
let scoreTimer = undefined as any

/**
 * 开启皇冠采集进程
 */
async function startCrownRobot() {
    console.log('采集皇冠比赛', !!process.env.CROWN_MATCHES)
    console.log('采集皇冠赛果', !!process.env.CROWN_SCORE)

    //设置WS的相关信息
    socket.setServiceType('crown')
    //监听滚球开启消息
    socket.registerSocketListener('rockball', () => {})

    while (true) {
        try {
            await init()

            //开启WS连接
            socket.start()

            if (process.env.CROWN_MATCHES) {
                matchTimer = setInterval(startCrownMatches, 600000)
            }
            if (process.env.CROWN_SCORE) {
                scoreTimer = setInterval(startCrownScore, 60000)
            }

            let errors = 0
            const [promise, close] = rabbitmq.consume(
                'crown_odd',
                async (content) => {
                    try {
                        await processCrownRequest(content)
                    } catch {
                        errors++
                        if (errors > 10) {
                            //累计失败10次后重启
                            close()
                        }
                    }
                },
                undefined,
                {
                    maxPriority: 20,
                },
            )
            await promise
        } finally {
            clearInterval(matchTimer)
            clearInterval(scoreTimer)
            socket.close()

            await reset()
            await rabbitmq.close()
        }
    }
}

if (require.main === module) {
    startCrownRobot()
}
