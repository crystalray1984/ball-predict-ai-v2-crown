import { getOddResult, runLoop } from './common/helpers'
import { Match, Promoted, Team, VMatch } from './db'
import {
    findMatch,
    FindMatchResult,
    getFinalMatches,
    getMatchScore,
    getTodayMatches,
} from './titan007'
import dayjs from 'dayjs'
import { intersection } from 'lodash'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { InferAttributes, Op, WhereOptions } from 'sequelize'

/**
 * 处理今日抓到的单场比赛数据
 */
async function processTodayMatch(match: VMatch, todayMatches: Titan007.TodayMatchInfo[]) {
    let found = undefined as unknown as FindMatchResult

    //从匹配的数据中寻找
    const exists = findMatch(match, todayMatches)
    if (exists) {
        //有找到
        match.titan007_match_id = exists.match_id
        match.titan007_swap = exists.swap ? 1 : 0
        if (!match.team1_titan007_id) {
            match.team1_titan007_id = exists.swap ? exists.team2_id : exists.team1_id
        }
        if (!match.team2_titan007_id) {
            match.team2_titan007_id = exists.swap ? exists.team1_id : exists.team2_id
        }
        found = exists
    } else {
        return
    }

    /**
     * 更新比赛数据
     */
    const updateMatch = async () => {
        const changed = match.changed()
        if (changed === false) return

        //涉及到队伍的修改
        if (changed.includes('team1_titan007_id')) {
            await Team.update(
                {
                    titan007_team_id: match.team1_titan007_id,
                },
                {
                    where: {
                        id: match.team1_id,
                        titan007_team_id: '',
                    },
                    returning: false,
                },
            )
        }
        if (changed.includes('team2_titan007_id')) {
            await Team.update(
                {
                    titan007_team_id: match.team2_titan007_id,
                },
                {
                    where: {
                        id: match.team2_id,
                        titan007_team_id: '',
                    },
                    returning: false,
                },
            )
        }

        //涉及到比赛的修改
        const matchKeys = intersection(
            [
                'titan007_match_id',
                'titan007_swap',
                'has_score',
                'score1',
                'score2',
                'corner1',
                'corner2',
                'has_period1_score',
                'score1_period1',
                'score2_period1',
                'corner1_period1',
                'corner2_period1',
            ],
            changed,
        )

        if (matchKeys.length > 0) {
            const updated: Partial<Match> = {}
            matchKeys.forEach((key) => {
                const objKey = key as keyof Match
                updated[objKey] = match[objKey]
            })

            console.log('更新比赛数据', `id=${match.id}`, updated)

            await Match.update(updated as Partial<Match>, {
                where: {
                    id: match.id,
                },
                returning: false,
            })
        }
    }

    let scoreResult = undefined as Period | undefined

    //找到了比赛，开始判断比赛数据
    if (found.state === -1) {
        //比赛已完场
        if (!match.has_score) {
            //数据库中的比赛没有结果，那么就抓取赛果来更新
            const score = await getMatchScore(match.titan007_match_id, match.titan007_swap)
            match.has_score = 1
            match.score1 = score.score1
            match.score2 = score.score2
            match.corner1 = score.corner1
            match.corner2 = score.corner2

            match.has_period1_score = 1
            match.score1_period1 = score.score1_period1
            match.score2_period1 = score.score2_period1
            match.corner1_period1 = score.corner1_period1
            match.corner2_period1 = score.corner2_period1

            scoreResult = 'regularTime'
        }
    } else if (found.state >= 2) {
        //上半场已结束
        if (!match.has_period1_score) {
            //数据库中的比赛没有结果，那么就抓取赛果来更新
            const score = await getMatchScore(match.titan007_match_id, match.titan007_swap)
            match.has_period1_score = 1
            match.score1_period1 = score.score1_period1
            match.score2_period1 = score.score2_period1
            match.corner1_period1 = score.corner1_period1
            match.corner2_period1 = score.corner2_period1

            scoreResult = 'period1'
        }
    }

    //保存比赛数据
    await updateMatch()

    return scoreResult
}

/**
 * 结算已完场的比赛
 * @param match
 * @param period
 */
export async function processFinalMatch(match: VMatch, period: Period): Promise<void> {
    const matchScore = {
        score1: match.score1!,
        score2: match.score2!,
        corner1: match.corner1!,
        corner2: match.corner2!,
        score1_period1: match.score1_period1!,
        score2_period1: match.score2_period1!,
        corner1_period1: match.corner1_period1!,
        corner2_period1: match.corner2_period1!,
    }

    const where: WhereOptions<InferAttributes<Promoted>> = {
        match_id: match.id,
        result: null,
    }
    if (period === 'period1') {
        where.period = 'period1'
    }

    const promotes = await Promoted.findAll({
        where,
    })

    for (const promoted of promotes) {
        const result = getOddResult(promoted, matchScore)
        if (!result) continue
        promoted.result = result.result
        promoted.score = result.score
        promoted.score1 = result.score1
        promoted.score2 = result.score2

        await promoted.save()
    }
}

/**
 * 从球探网抓取今日的比赛列表，与本地的比赛列表做对比，写入比赛id和赛果数据
 */
async function processTodayMatches() {
    //读取今日比赛列表
    const todayMatches = await getTodayMatches()
    if (todayMatches.length === 0) return

    console.log('抓取到今日比赛数据', todayMatches.length)
    await writeFile(
        resolve(__dirname, '../runtime/logs/titan007_today.json'),
        JSON.stringify(todayMatches, null, 4),
        'utf-8',
    )

    //确定抓取到的比赛时间范围
    const times = todayMatches.map((t) => t.match_time)
    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)

    console.log('当前时间', new Date())
    console.log('今日比赛时间范围', minTime, maxTime)
    console.log('今日比赛时间范围', new Date(minTime), new Date(maxTime))

    //从数据库中读取比赛列表
    const matches = await VMatch.findAll({
        where: {
            [Op.and]: [
                {
                    match_time: {
                        [Op.between]: [new Date(minTime), new Date(maxTime)],
                    },
                },
                {
                    [Op.or]: [{ titan007_match_id: '' }, { has_score: 0 }],
                },
            ],
        },
    })

    console.log('数据库中匹配的比赛', matches.length)

    /**
     * 已经完场的比赛
     */
    const finalRegularTimeMatches: VMatch[] = []
    /**
     * 已经上半场结束的比赛
     */
    const finalPeriod1Matches: VMatch[] = []

    for (const match of matches) {
        try {
            const period = await processTodayMatch(match, todayMatches)
            switch (period) {
                case 'regularTime':
                    finalRegularTimeMatches.push(match)
                    break
                case 'period1':
                    finalPeriod1Matches.push(match)
                    break
            }
        } catch (err) {
            console.error(err)
        }
    }

    //比分结算
    if (finalRegularTimeMatches.length > 0) {
        for (const match of finalRegularTimeMatches) {
            console.log(
                '结算比分',
                `match_id=${match.id}`,
                `titan007_match_id=${match.titan007_match_id}`,
                'regularTime',
            )
            try {
                await processFinalMatch(match, 'regularTime')
            } catch (err) {
                console.error(err)
            }
        }
    }
    if (finalPeriod1Matches.length > 0) {
        for (const match of finalPeriod1Matches) {
            console.log(
                '结算比分',
                `match_id=${match.id}`,
                `titan007_match_id=${match.titan007_match_id}`,
                'period1',
            )
            try {
                await processFinalMatch(match, 'period1')
            } catch (err) {
                console.error(err)
            }
        }
    }
}

/**
 * 处理昨日的完场数据赛果
 */
async function processYesterdayMatches() {
    const now = dayjs()
    const nowTime = now.hour() * 100 + now.minute()
    if (nowTime < 1210) return

    const today = now.clone().startOf('day')

    //查询是否存在需要计算赛果的比赛
    const matches = await VMatch.findAll({
        where: {
            match_time: {
                [Op.between]: [
                    today.clone().subtract(12, 'hour').toDate(),
                    today.clone().add(12, 'hour').toDate(),
                ],
            },
            has_score: 0,
        },
    })

    console.log('需要获取昨日赛果的比赛', matches.length)
    if (matches.length === 0) return

    //读取昨日的赛果
    let finalMatches = await getFinalMatches(today.clone().subtract(1, 'day'))
    console.log('昨日赛果数据', finalMatches.length)
    if (finalMatches.length === 0) return

    //赛果匹配
    for (const match of matches) {
        let found: FindMatchResult | undefined = undefined
        if (match.titan007_match_id) {
            //比赛原本有球探网id

            const exists = finalMatches.find((t) => t.match_id === match.titan007_match_id)
            if (exists) {
                if (exists.state !== -1) {
                    //比赛有异常，跳过
                    continue
                }
            } else {
                console.log(
                    '未找到匹配的比赛1',
                    match.id,
                    match.match_time,
                    match.team1_name,
                    match.team2_name,
                )
                continue
            }

            found = {
                ...exists,
                swap: match.titan007_swap === 1,
            }
        } else {
            //比赛没有球探网id
            const exists = findMatch(match, finalMatches)
            if (exists) {
                if (exists.state !== -1) {
                    //比赛有异常，跳过
                    continue
                }
            } else {
                console.log(
                    '未找到匹配的比赛2',
                    match.id,
                    match.match_time,
                    match.team1_name,
                    match.team2_name,
                )
                continue
            }

            found = exists
        }

        //抓取赛果
        try {
            const score = await getMatchScore(found.match_id, found.swap)

            //更新赛果
            await Match.update(
                {
                    has_score: 1,
                    score1: score.score1,
                    score2: score.score2,
                    corner1: score.corner1,
                    corner2: score.corner2,
                    has_period1_score: 1,
                    score1_period1: score.score1_period1,
                    score2_period1: score.score2_period1,
                    corner1_period1: score.corner1_period1,
                    corner2_period1: score.corner2_period1,
                },
                {
                    where: {
                        id: match.id,
                    },
                    returning: false,
                },
            )

            //更新投注
            Object.assign(match, score)
            await processFinalMatch(match, 'regularTime')
            console.log('更新赛果', match.id)
        } catch (err) {
            console.error(err)
        }
    }
}

/**
 * 开始球探网数据抓取
 */
export function startTitan007() {
    //每2分钟执行一次今日比赛数据抓取
    runLoop(120000, processTodayMatches)
    //每2分钟执行一次昨日比赛数据抓取
    runLoop(120000, processYesterdayMatches)
    //每分钟执行一次盘口抓取
    // runLoop(60000, processOdds)
}

if (require.main === module) {
    startTitan007()
}
