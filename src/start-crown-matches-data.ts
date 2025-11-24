import { consume } from '@/common/rabbitmq'
import { CONFIG } from '@/config'
import { db, Match, PromotedOdd } from '@/db'
import { QueryTypes } from 'sequelize'
import { getOddResult } from './common/helpers'

/**
 * 解析从队列中得到的皇冠比赛数据
 * @param content
 */
async function parseCrownMatchesData(content: string) {
    const matches = JSON.parse(content) as Crown.MatchInfo[]

    //插入比赛数据
    let newCount = 0
    for (const match of matches) {
        const [_, isNew] = await Match.prepare(match)
        if (isNew) {
            newCount++
        }
    }
    console.log(`新增比赛数据`, newCount)
}

/**
 * 开启皇冠比赛数据写入队列
 */
async function startCrownMatchesData() {
    while (true) {
        const [promise] = consume(CONFIG.queues['crown_matches_data'], parseCrownMatchesData)
        await promise
    }
}

async function parseCrownScoreData(content: string) {
    const list = JSON.parse(content) as Crown.ScoreInfo[]

    for (const score of list) {
        //查询对应的比赛
        const matches = await db.query<{ id: number }>(
            {
                query: `
            SELECT
                "match".id
            FROM
                "match"
            INNER JOIN
                tournament ON tournament.id = "match".tournament_id
            INNER JOIN
                team AS team1 ON team1.id = "match".team1_id
            INNER JOIN
                team AS team2 ON team2.id = "match".team2_id
            WHERE
                "match".match_time BETWEEN ? AND ?
                AND "match".has_score = 0
                AND tournament.crown_tournament_id = ?
                AND team1.name = ?
                AND team2.name = ?
            LIMIT 1
            `,
                values: [
                    new Date(score.match_time - 600000),
                    new Date(score.match_time + 600000),
                    score.league_id,
                    score.team1,
                    score.team2,
                ],
            },
            {
                type: QueryTypes.SELECT,
            },
        )

        if (matches.length === 0) continue
        const match = matches[0]

        //写入完场比分数据
        await Match.update(
            {
                score1: score.score1,
                score2: score.score2,
                score1_period1: score.score1_period1,
                score2_period1: score.score2_period1,
                has_score: 1,
                has_period1_score: 1,
            },
            {
                where: {
                    id: match.id,
                },
            },
        )

        //处理缺少赛果的比赛
        const odds = await PromotedOdd.findAll({
            where: {
                match_id: match.id,
                result: null,
                variety: 'goal',
            },
        })

        for (const odd of odds) {
            const result = getOddResult(odd, score as any)
            if (result) {
                odd.result = odd.result1 = result.result
                odd.score1 = result.score1
                odd.score2 = result.score2
                odd.score = result.score
                await odd.save()
            }
        }
    }
}

/**
 * 开启皇冠赛果数据写入队列
 */
async function startCrownScoreData() {
    while (true) {
        const [promise] = consume(CONFIG.queues['crown_score_data'], parseCrownScoreData)
        await promise
    }
}

if (require.main === module) {
    startCrownMatchesData()
    startCrownScoreData()
}
