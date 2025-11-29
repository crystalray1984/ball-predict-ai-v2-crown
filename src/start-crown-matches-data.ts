import { Match, Promoted, VMatch } from '@/db'
import { Op } from 'sequelize'
import { getOddResult } from './common/helpers'
import { consume } from './common/rabbitmq'
import { CONFIG } from './config'

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
        const match = await VMatch.findOne({
            where: {
                match_time: {
                    [Op.between]: [
                        new Date(score.match_time - 600000),
                        new Date(score.match_time + 600000),
                    ],
                },
                crown_match_id: score.league_id,
                team1_name: score.team1,
                team2_name: score.team2,
            },
        })

        if (!match) continue

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
        const promotes = await Promoted.findAll({
            where: {
                match_id: match.id,
                result: null,
                variety: 'goal',
            },
        })

        for (const promoted of promotes) {
            const result = getOddResult(promoted, score as any)
            if (result) {
                promoted.result = result.result
                promoted.score1 = result.score1
                promoted.score2 = result.score2
                promoted.score = result.score
                await promoted.save()
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
