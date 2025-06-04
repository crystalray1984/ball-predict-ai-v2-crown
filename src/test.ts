import { Op } from 'sequelize'
import { VMatch } from './db'
import { findMatch, FindMatchResult, getMatchScore, getTodayMatches } from './titan007'
import { intersection, pick } from 'lodash'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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
        if (changed === false) {
            console.log('changed', {})
            return
        }
        const updated = pick(match, changed)
        console.log('changed', updated)
        return
    }

    let scoreResult = undefined as Period | undefined

    //找到了比赛，开始判断比赛数据
    if (found.state === -1) {
        //比赛已完场
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
    } else if (found.state >= 2) {
        //上半场已结束
        const score = await getMatchScore(match.titan007_match_id, match.titan007_swap)
        match.has_period1_score = 1
        match.score1_period1 = score.score1_period1
        match.score2_period1 = score.score2_period1
        match.corner1_period1 = score.corner1_period1
        match.corner2_period1 = score.corner2_period1

        scoreResult = 'period1'
    }

    //保存比赛数据
    await updateMatch()

    return scoreResult
}

async function main() {
    const matches = await VMatch.findAll({
        where: {
            id: {
                [Op.in]: [7115, 7138, 7061],
            },
        },
    })

    const todayMatches = await getTodayMatches()

    todayMatches.forEach((match) => {
        console.log(match)
    })

    await writeFile(resolve(__dirname, './titan007.json'), JSON.stringify(todayMatches), 'utf-8')

    for (const match of matches) {
        const period = await processTodayMatch(match, todayMatches)
        console.log(match.id, period)
    }
}

main()
    .then(() => {
        process.exit()
    })
    .catch((err) => {
        console.error(err)
        process.exit()
    })
