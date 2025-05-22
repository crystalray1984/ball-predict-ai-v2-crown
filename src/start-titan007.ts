import { getOddResult, isNullOrUndefined, runLoop } from '@/common/helpers'
import { db, Match, PromotedOdd, Team, Titan007Odd, VMatch } from '@/db'
import {
    findMatch,
    FindMatchResult,
    getFinalMatches,
    getMatchOdd,
    getMatchScore,
    getTodayMatches,
} from '@/titan007'
import dayjs from 'dayjs'
import { intersection } from 'lodash'
import { InferAttributes, Op, QueryTypes, WhereOptions } from 'sequelize'

/**
 * 处理今日抓到的单场比赛数据
 */
async function processTodayMatch(match: VMatch, todayMatches: Titan007.TodayMatchInfo[]) {
    let found = undefined as unknown as FindMatchResult

    if (!match.titan007_match_id) {
        //如果比赛还没有球探网数据id的，那么尝试根据数据去做匹配
        const exists = findMatch(match, todayMatches)
        if (exists) {
            let titan007_match_id = exists.match_id
            //更新比赛数据
            match.titan007_match_id = titan007_match_id
            match.titan007_swap = exists.swap ? 1 : 0

            //更新球队数据
            if (!match.team1_titan007_id) {
                match.team1_titan007_id = exists.swap ? exists.team2_id : exists.team1_id
            }
            if (!match.team2_titan007_id) {
                match.team2_titan007_id = exists.swap ? exists.team1_id : exists.team2_id
            }

            console.log(
                '新增匹配的比赛',
                match.id,
                new Date(match.match_time),
                match.team1_name,
                match.team2_name,
            )
        } else {
            //如果没有匹配的数据，那么后续肯定也没有匹配的了，直接跳过了
            return
        }

        found = exists
    } else {
        const exists = todayMatches.find((t) => t.match_id === match.titan007_match_id)
        if (!exists) {
            //没有找到比赛
            return
        }

        found = {
            ...exists,
            swap: match.titan007_swap === 1,
        }
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
            const score = await getMatchScore(match.titan007_match_id)
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
            const score = await getMatchScore(match.titan007_match_id)
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
async function processFinalMatch(match: VMatch, period: Period): Promise<void> {
    const where: WhereOptions<InferAttributes<PromotedOdd>> = {
        match_id: match.id,
        result: null,
    }
    if (period === 'period1') {
        where.period = 'period1'
    }
    const odds = await PromotedOdd.findAll({
        where,
    })
    if (odds.length === 0) return

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

    for (const odd of odds) {
        const result1 = getOddResult(odd, matchScore)
        if (!result1) continue
        odd.result1 = result1.result
        odd.score = result1.score
        odd.score1 = result1.score1
        odd.score2 = result1.score2

        //有第二盘口
        if (!isNullOrUndefined(odd.type2) && !isNullOrUndefined(odd.condition2)) {
            const result2 = getOddResult(
                {
                    variety: odd.variety,
                    period: odd.period,
                    type: odd.type2,
                    condition: odd.condition2,
                },
                matchScore,
            )
            if (result2) {
                odd.result2 = result2.result
            }
        }

        if (isNullOrUndefined(odd.result2)) {
            odd.result = odd.result1
        } else if (odd.result1 === 1 || odd.result2 === 1) {
            odd.result = 1
        } else if (odd.result1 === 0 && odd.result2 === 0) {
            odd.result = 0
        } else {
            odd.result = -1
        }
        await odd.save()
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

    //确定抓取到的比赛时间范围
    const times = todayMatches.map((t) => t.match_time)
    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)

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
            try {
                await processFinalMatch(match, 'regularTime')
            } catch (err) {}
        }
    }
    if (finalPeriod1Matches.length > 0) {
        for (const match of finalPeriod1Matches) {
            try {
                await processFinalMatch(match, 'period1')
            } catch (err) {}
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
            let titan007_match_id = match.titan007_match_id
            let swap = false
            if (titan007_match_id.startsWith('-')) {
                swap = true
                match.titan007_match_id = titan007_match_id = titan007_match_id.substring(1)
            }

            const exists = finalMatches.find((t) => t.match_id === titan007_match_id)
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
                swap,
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
        let id = found.match_id
        if (found.swap) {
            id = `-${id}`
        }
        try {
            const score = await getMatchScore(id)

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
 * 盘口抓取
 */
async function processOdds() {
    //获取需要计算盘口的比赛
    const matches = await db.query<{
        id: number
        titan007_match_id: string
    }>(
        {
            query: `
        SELECT
            DISTINCT
            a.id,
            a.titan007_match_id
        FROM
            match AS a
        INNER JOIN
            odd ON odd.match_id = a.id AND odd.status = ?
        WHERE
            a.match_time >= ?
            AND a.match_time <= ?
            AND a.titan007_match_id != ?
        `,
            values: [
                'ready',
                new Date(Date.now() + 120000), //2分钟内开赛的比赛不抓取
                new Date(Date.now() + 600000), //只抓取10分内开赛的比赛
                '', //不抓取没有匹配到球探网id的比赛
            ],
        },
        {
            type: QueryTypes.SELECT,
        },
    )
    console.log('需要抓取盘口的比赛', matches.length)
    if (matches.length === 0) return

    for (const match of matches) {
        //读取盘口
        const odd = await getMatchOdd(match.titan007_match_id)
        //更新数据
        const exists = await Titan007Odd.findOne({
            where: {
                match_id: match.id,
            },
        })
        if (exists) {
            //更新数据
            if (odd.ah) {
                exists.ah_start = odd.ah.start
                exists.ah_end = odd.ah.end
            }
            if (odd.goal) {
                exists.goal_start = odd.goal.start
                exists.goal_end = odd.goal.end
            }
            if (odd.ah_period1) {
                exists.ah_period1_start = odd.ah_period1.start
                exists.ah_period1_end = odd.ah_period1.end
            }
            if (odd.goal_period1) {
                exists.goal_period1_start = odd.goal_period1.start
                exists.goal_period1_end = odd.goal_period1.end
            }
            if (odd.corner) {
                if (odd.corner.ah) {
                    exists.corner_ah_start = odd.corner.ah.start
                    exists.corner_ah_end = odd.corner.ah.end
                }
                if (odd.corner.goal) {
                    exists.corner_goal_start = odd.corner.goal.start
                    exists.corner_goal_end = odd.corner.goal.end
                }
            }

            await exists.save()
        } else {
            //写入新数据
            await Titan007Odd.create({
                match_id: match.id,
                titan007_match_id: match.titan007_match_id,
                ah_start: odd.ah?.start ?? null,
                ah_end: odd.ah?.end ?? null,
                goal_start: odd.goal?.start ?? null,
                goal_end: odd.goal?.end ?? null,
                ah_period1_start: odd.ah_period1?.start ?? null,
                ah_period1_end: odd.ah_period1?.end ?? null,
                goal_period1_start: odd.goal_period1?.start ?? null,
                goal_period1_end: odd.goal_period1?.end ?? null,
                corner_ah_start: odd.corner?.ah?.start ?? null,
                corner_ah_end: odd.corner?.ah?.end ?? null,
                corner_goal_start: odd.corner?.goal?.start ?? null,
                corner_goal_end: odd.corner?.goal?.end ?? null,
            })
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
    runLoop(60000, processOdds)
}

if (require.main === module) {
    startTitan007()
}
