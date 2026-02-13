import dayjs from 'dayjs'
import { Attributes, QueryTypes } from 'sequelize'
import { findMatch, getMatchDetails, getMatches } from './common/fotmob'
import { isNullOrUndefined, runLoop } from './common/helpers'
import { db, Match, Team, VMatch } from './db'
import { processFinalMatch } from './start-titan007'
import { uniq } from 'lodash'

/**
 * 比赛处理
 * 能通过此方法处理的必须已经填充好fotmob_match_id
 * @param match
 */
async function processMatch(match: VMatch) {
    //查询比赛详情
    const details = await getMatchDetails(match.fotmob_match_id)
    if (!details) return

    const updates: Partial<Attributes<Match>> = {}

    let period: Period = 'period1'

    if (!match.has_period1_score) {
        if (
            isNullOrUndefined(details.score1_period1) ||
            isNullOrUndefined(details.score2_period1)
        ) {
            return
        }
        if (match.fotmob_swap) {
            updates.score1_period1 = match.score1_period1 = details.score2_period1
            updates.score2_period1 = match.score2_period1 = details.score1_period1
        } else {
            updates.score1_period1 = match.score1_period1 = details.score1_period1
            updates.score2_period1 = match.score2_period1 = details.score2_period1
        }
        updates.has_period1_score = match.has_period1_score = 1
        period = 'period1'
    }
    if (!match.has_score) {
        if (!isNullOrUndefined(details.score1) && !isNullOrUndefined(details.score2)) {
            if (match.fotmob_swap) {
                updates.score1 = match.score1 = details.score2
                updates.score2 = match.score2 = details.score1
            } else {
                updates.score1 = match.score1 = details.score1
                updates.score2 = match.score2 = details.score2
            }
            updates.has_score = match.has_score = 1
            period = 'regularTime'
        }
    }

    if (Object.keys(updates).length === 0) {
        //没有需要更新的字段
        return
    }

    //开始更新赛果
    await Match.update(updates, {
        where: {
            id: match.id,
        },
        returning: false,
    })

    //开始结算
    await processFinalMatch(match, period)
}

/**
 * 启动fotmob.com赛果采集进程
 */
async function startFotmob() {
    const now = new Date()

    //读取最近3天的比赛
    let matches = await db.query(
        `
            SELECT
                id,
                match_time,
                fotmob_match_id,
                fotmob_swap,
                team1_id,
                team1_fotmob_id,
                team1_name,
                team1_i18n_name,
                team2_id,
                team2_fotmob_id,
                team2_name,
                team2_i18n_name,
                has_score,
                score1,
                score2,
                has_period1_score,
                score1_period1,
                score2_period1
            FROM
                v_match
            WHERE
                match_time BETWEEN '${dayjs(now).startOf('day').subtract(3, 'days').toISOString()}' AND '${dayjs(now).endOf('day').toISOString()}'
                AND has_score = 0
                AND "team1_i18n_name" ? 'en'
                AND "team2_i18n_name" ? 'en'
            ORDER BY
                match_time
            `,
        {
            type: QueryTypes.SELECT,
            model: VMatch,
        },
    )

    if (matches.length === 0) return

    console.log('需要采集数据的比赛', matches.length)

    //第一次筛选，先筛选所有有fotmob_match_id的比赛，这些比赛直接就查询详情接口了
    const hasIdMatches: VMatch[] = matches.filter((t) => t.fotmob_match_id)
    matches = matches.filter((t) => !t.fotmob_match_id)

    //直接调用接口去查询已有id的比赛
    for (const match of hasIdMatches) {
        try {
            await processMatch(match)
        } catch (err) {
            console.error(err)
        }
    }

    if (matches.length === 0) return

    //有剩下的比赛，那就去采集比赛数据
    //先整理比赛日期
    const dates = uniq(matches.map((t) => dayjs(t.match_time).format('YYYYMMDD'))).sort()

    //采集比赛数据
    let fotmobMatches: Fotmob.Match[] = []
    for (const date of dates) {
        const list = await getMatches(date)
        fotmobMatches = fotmobMatches.concat(list)
    }

    //进行比赛比对
    for (const match of matches) {
        //对比赛的队伍名称进行初始化
        match.team1_name = match.team1_i18n_name!.en
        match.team2_name = match.team2_i18n_name!.en

        //比赛搜索
        const matched = findMatch(match, fotmobMatches)
        if (!matched) {
            continue
        }

        console.log(
            '匹配比赛',
            match.id,
            match.match_time,
            match.team1_name,
            'VS',
            match.team2_name,
        )

        //更新比赛基础数据
        if (!match.fotmob_match_id) {
            await Match.update(
                {
                    fotmob_match_id: matched.match_id,
                    fotmob_swap: matched.swap,
                },
                {
                    where: {
                        id: match.id,
                    },
                    returning: false,
                },
            )
            match.fotmob_match_id = matched.match_id
            match.fotmob_swap = matched.swap
        }
        //更新队伍数据
        if (!match.team1_fotmob_id) {
            await Team.update(
                {
                    fotmob_team_id: matched.team1_id,
                },
                {
                    where: { id: match.team1_id },
                    returning: false,
                },
            )
            match.team1_fotmob_id = matched.team1_id
        }
        if (!match.team2_fotmob_id) {
            await Team.update(
                {
                    fotmob_team_id: matched.team2_id,
                },
                {
                    where: { id: match.team2_id },
                    returning: false,
                },
            )
            match.team2_fotmob_id = matched.team2_id
        }

        //如果比赛尚未开始就不需要采集比分了
        if (!matched.started) continue
        //如果比赛距离开始还不足45分钟也不需要采集比分了
        if (Date.now() - match.match_time.valueOf() < 270000) continue
        //采集比分
        try {
            await processMatch(match)
        } catch (err) {
            console.error(err)
        }
    }
}

if (require.main === module) {
    runLoop(120000, startFotmob)
}
