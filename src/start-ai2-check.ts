import { CONFIG, ROOT } from '@/config'
import axios, { AxiosHeaders } from 'axios'
import dayjs from 'dayjs'
import Decimal from 'decimal.js'
import { uniq } from 'lodash'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Op } from 'sequelize'
import { CROWN_ODD_QUEUE } from './common/constants'
import { clearChannelCache, delay, getOddIdentification, isFileExists } from './common/helpers'
import { consume, publish } from './common/rabbitmq'
import { RateLimiter } from './common/rate-limiter'
import { findMatchedOdd } from './crown'
import { Ai2MissMatch, Match, Promoted, Team, VMatch } from './db'
import { findMatch } from './titan007'

/**
 * 接口响应体
 */
interface AIResp {
    code: number
    message: string
    items: AIMatchItem[]
}

/**
 * 比赛数据
 */
interface AIMatchItem {
    /**
     * 球探网比赛id
     */
    match_id: number
    /**
     * 联赛名称
     */
    league_name: string
    /**
     * 比赛时间
     * '2026-05-04T19:00:00+08:00'
     */
    kickoff_at: string
    /**
     * 主队球探id
     */
    home_team_id: number
    /**
     * 主队名称
     * '东京绿茵'
     */
    home_team: string
    /**
     * 客队球探id
     */
    away_team_id: number
    /**
     * 客队名称
     * '鹿岛鹿角'
     */
    away_team: string
    /**
     * '2026-05-04T19:00:00+08:00'
     */
    visible_until: string
    /**
     * 推荐项列表
     */
    tasks: AITaskItem[]
}

/**
 * 推荐任务数据
 */
interface AITaskItemBase<T extends string> {
    /**
     * 盘口类型
     */
    task_name: T
}

/**
 * 让球盘任务数据
 */
interface AITaskAHItem extends AITaskItemBase<'ah'> {
    /**
     * 推荐方向
     */
    side_code: 'home' | 'away'
    /**
     * 盘口条件
     */
    line_text: NumberVal
}

/**
 * 大小球盘任务数据
 */
interface AITaskOUItem extends AITaskItemBase<'ou'> {
    /**
     * 推荐方向
     */
    side_code: 'over' | 'under'
    /**
     * 盘口条件
     */
    line_text: NumberVal
}

/**
 * BTTS任务数据
 */
interface AITaskBTTSItem extends AITaskItemBase<'btts'> {
    /**
     * 推荐方向
     */
    side_code: 'yes' | 'no'
}

type AITaskItem = AITaskAHItem | AITaskOUItem | AITaskBTTSItem

const CHANNEL = 'ai2'

/**
 * 创建调用接口的客户端
 */
const client = axios.create({
    baseURL: CONFIG.ai2.api_url,
    proxy: CONFIG.ai2.proxy,
    headers: {
        'X-API-Token': CONFIG.ai2.api_token,
        Accept: 'application/json',
    },
})

/**
 * 限制接口调用的限制器
 */
const limiter = new RateLimiter(120000)

/**
 * 调用接口并处理数据，自动处理ETag机制
 * @param url 要调用的接口地址
 */
async function withApi(
    url: string,
    runner: (items: AIMatchItem[]) => Promise<boolean>,
    useCache = false,
) {
    //把接口地址转换为etag缓存路径
    const etagFile = 'ai2_' + url.replace(/[^a-z0-9]/gi, '') + '.txt'
    const etagPath = resolve(ROOT, `./runtime/${etagFile}`)

    //尝试获取etag缓存
    let etag = ''
    let cache = ''
    if (await isFileExists(etagPath)) {
        const content = await readFile(etagPath, 'utf-8')
        const parts = content.split('\n')
        etag = parts[0]
        cache = parts[1]
    }

    const headers: Record<string, string> = {}
    if (etag) {
        headers['If-None-Match'] = etag
    }

    //接口延迟
    await limiter.next()

    //调用接口
    const resp = await client.request<string>({
        method: 'GET',
        url,
        headers,
        responseType: 'text',
        validateStatus: (status) => status < 400,
    })

    if (resp.status === 304) {
        //接口数据无变化
        if (useCache && cache) {
            const data: AIResp = JSON.parse(cache)
            await runner(data.items)
        }
        return
    }

    console.log(url)
    console.log(resp.data)

    //解析数据
    const data: AIResp = JSON.parse(resp.data)

    if (data.code !== 0 || !Array.isArray(data.items)) {
        //接口异常
        return
    }

    let saveEtag = true
    if (data.items.length > 0) {
        //调用接口
        saveEtag = await runner(data.items)
    }

    if (saveEtag) {
        //保存etag
        const etag = AxiosHeaders.from(resp.headers as any).get('etag')
        if (typeof etag === 'string') {
            await writeFile(etagPath, etag, 'utf-8')
        }
    }
}

/**
 * 尝试寻找匹配的比赛
 * @param matchItem
 */
async function tryFindMatch(matchItem: AIMatchItem) {
    const matchTime = dayjs(matchItem.kickoff_at).toDate()

    //构建球探比赛数据
    const info: Titan007.TodayMatchInfo = {
        match_id: matchItem.match_id.toString(),
        team1_id: matchItem.home_team_id.toString(),
        team2_id: matchItem.away_team_id.toString(),
        team1: matchItem.home_team,
        team2: matchItem.away_team,
        state: 1,
        match_time: matchTime.valueOf(),
    }

    //查询误差范围内的比赛
    const matches = await VMatch.findAll({
        where: {
            match_time: {
                [Op.between]: [
                    new Date(matchTime.valueOf() - 900000),
                    new Date(matchTime.valueOf() + 900000),
                ],
            },
        },
    })

    if (matches.length === 0) {
        return false
    }

    //寻找匹配的比赛
    for (const match of matches) {
        const found = findMatch(match, [info])
        if (found) {
            if (!match.team1_titan007_id) {
                await Team.update(
                    {
                        titan007_team_id: found.team1_id,
                    },
                    {
                        where: {
                            id: match.team1_id,
                        },
                    },
                )
            }
            if (!match.team2_titan007_id) {
                await Team.update(
                    {
                        titan007_team_id: found.team2_id,
                    },
                    {
                        where: {
                            id: match.team2_id,
                        },
                    },
                )
            }

            await Match.update(
                {
                    titan007_match_id: found.match_id,
                    titan007_swap: found.swap ? 1 : 0,
                },
                {
                    where: {
                        id: match.id,
                    },
                },
            )

            return true
        }
    }

    return false
}

/**
 * 预先处理比赛数据
 */
async function processSnapshot(items: AIMatchItem[]): Promise<boolean> {
    if (items.length === 0) return true

    //先做第一波筛选，取出所有的比赛id到比赛表查询
    const matches = await Match.findAll({
        where: {
            titan007_match_id: {
                [Op.in]: items.map((t) => t.match_id.toString()),
            },
        },
        attributes: ['titan007_match_id'],
    })
    const matchIds = matches.map((t) => t.titan007_match_id)

    //筛选没有数据的比赛
    items = items.filter((t) => !matchIds.includes(t.match_id.toString()))

    //所有比赛都有数据就出去
    if (items.length === 0) return true

    let pass = true

    for (const matchItem of items) {
        //没有找到对应的比赛，就要尝试通过皇冠的比赛去匹配
        if (await tryFindMatch(matchItem)) {
            continue
        }

        //没有找到比赛，就写入待处理的比赛记录
        await Ai2MissMatch.upsert(
            {
                match_id: matchItem.match_id.toString(),
                team1_id: matchItem.home_team_id.toString(),
                team1_name: matchItem.home_team,
                team2_id: matchItem.away_team_id.toString(),
                team2_name: matchItem.away_team,
                match_time: dayjs(matchItem.kickoff_at).toDate(),
                tournament_name: matchItem.league_name,
            },
            {
                returning: false,
            },
        )
        pass = false
    }

    return pass
}

/**
 * 预先处理比赛数据
 */
async function startProcessSnapshot() {
    while (true) {
        try {
            await withApi('/api/v1/prematch/snapshot', processSnapshot)
        } catch (err) {
            console.error(err)
        }

        //等待10分钟
        await delay(600000)
    }
}

/**
 * 处理推荐比赛
 * @param item
 */
async function processPromoteMatch(
    item: AIMatchItem,
    match: Pick<Match, 'id' | 'crown_match_id' | 'titan007_swap' | 'match_time'>,
) {
    //首先看要推荐的内容是否已经有了
    const types = uniq(
        item.tasks.map((task): OddIdentification => {
            switch (task.task_name) {
                case 'ah':
                    return 'ah'
                case 'ou':
                    return 'sum'
                case 'btts':
                    return 'btts'
            }
        }),
    )

    const exists = (
        await Promoted.findAll({
            where: {
                match_id: match.id,
                odd_type: {
                    [Op.in]: types,
                },
                channel: CHANNEL,
            },
            attributes: ['odd_type'],
        })
    ).map((t) => t.odd_type)

    //筛选推荐数据
    const tasks = item.tasks.filter((task) => {
        switch (task.task_name) {
            case 'ah':
                return !exists.includes('ah')
            case 'ou':
                return !exists.includes('sum')
            case 'btts':
                return !exists.includes('btts')
            default:
                return false
        }
    })

    if (tasks.length === 0) return

    if (match.titan007_swap) {
        //交换主客队
        tasks.forEach((task) => {
            if (task.task_name !== 'ah') return
            switch (task.side_code) {
                case 'home':
                    task.side_code = 'away'
                    break
                case 'away':
                    task.side_code = 'home'
                    break
            }
            task.line_text = Decimal(0).sub(task.line_text).toString()
        })
    }

    //把盘口转换为我们自己的数据格式
    const odds = tasks.map((task): OddInfo => {
        let type: OddType
        let condition: string
        switch (task.task_name) {
            case 'ah':
                if (task.side_code === 'home') {
                    type = 'ah1'
                } else {
                    type = 'ah2'
                }
                condition = Decimal(task.line_text).toString()
                break
            case 'ou':
                type = task.side_code
                condition = Decimal(task.line_text).toString()
                break
            case 'btts':
                if (task.side_code === 'yes') {
                    type = 'btts_yes'
                } else {
                    type = 'btts_no'
                }
                condition = '0'
                break
        }

        return {
            period: 'regularTime',
            variety: 'goal',
            type,
            condition,
        }
    })

    //抛到皇冠队列采集水位
    await publish(
        CROWN_ODD_QUEUE,
        JSON.stringify({
            crown_match_id: match.crown_match_id,
            next: 'ai2_after_check',
            extra: odds,
        }),
    )
}

/**
 * 处理推荐数据
 * @param items
 */
async function processPromote(items: AIMatchItem[]): Promise<boolean> {
    for (const item of items) {
        if (item.tasks.length === 0) continue

        const match_time = dayjs(item.kickoff_at)
        if (match_time.valueOf() <= Date.now()) continue

        //先获取比赛基础数据
        const match = await Match.findOne({
            where: {
                titan007_match_id: item.match_id.toString(),
            },
            attributes: ['id', 'crown_match_id', 'titan007_swap', 'match_time'],
        })

        if (!match) continue
        if (match.match_time.valueOf() <= Date.now()) continue

        //处理推荐
        await processPromoteMatch(item, match)
    }
    return true
}

/**
 * 处理从皇冠采集完盘口后抛回来的数据
 * @param param0
 * @returns
 */
async function processCheck(output: CrownRobot.Output<OddInfo[]>) {
    console.log(output)
    const { crown_match_id, data, extra } = output
    if (!data || !extra) return

    const match = await Match.findOne({
        where: {
            crown_match_id,
        },
        attributes: ['id', 'match_time'],
    })
    if (!match) return
    if (match.match_time.valueOf() <= Date.now()) return

    //处理各个盘口
    for (const info of extra) {
        //寻找匹配的盘口
        const odds = findMatchedOdd(info, data.odds)
        const odd = odds.find((t) => Decimal(t.condition).eq(info.condition))
        if (!odd) continue

        const odd_type = getOddIdentification(info.type)

        //插入推荐
        const exists = await Promoted.findOne({
            where: {
                match_id: match.id,
                channel: CHANNEL,
                odd_type,
            },
            attributes: ['id'],
        })
        if (exists) continue

        const promoted = await Promoted.create({
            match_id: match.id,
            source_type: '',
            source_id: 0,
            channel: CHANNEL,
            is_valid: 1,
            skip: '',
            week_day: 0,
            week_id: 0,
            variety: 'goal',
            period: 'regularTime',
            type: info.type,
            condition: info.condition,
            odd_type,
            value: odd.value,
        })

        //清理频道缓存数据
        await clearChannelCache(CHANNEL)

        await publish(
            CONFIG.queues['send_promoted'],
            JSON.stringify({ id: promoted.id, type: CHANNEL }),
        )
    }
}

/**
 * 开启消费队列监听
 */
async function startConsumer() {
    while (true) {
        const [promise] = consume('ai2_after_check', (content) => processCheck(JSON.parse(content)))
        await promise
    }
}

/**
 * 开始处理推荐数据
 */
async function startProcessPromote() {
    while (true) {
        try {
            await withApi('/api/v1/special/prematch', processPromote, true)
        } catch (err) {
            console.error(err)
        }

        //等待2分钟
        await delay(120000)
    }
}

if (require.main === module) {
    startProcessSnapshot()
    startProcessPromote()
    startConsumer()
}
