import { InferCreationAttributes, Op } from 'sequelize'
import { clearChannelCache, getOddResult } from './common/helpers'
import { consume } from './common/rabbitmq'
import { CONFIG } from './config'
import { Match, Promoted, RockballOdd, Team, Tournament, VMatch } from './db'
import { createRockball5 } from './common/rockball'

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

async function startCrownMatchesDataFake() {
    while (true) {
        const [promise] = consume('crown_matches_data', () => {})
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

        /**
         * 需要清楚缓存的频道
         */
        const channels: string[] = []

        for (const promoted of promotes) {
            const result = getOddResult(promoted, score as any)
            if (result) {
                promoted.result = result.result
                promoted.score1 = result.score1
                promoted.score2 = result.score2
                promoted.score = result.score
                promoted.result_value = result.result_value
                promoted.result_profit = result.result_profit
                channels.push(promoted.channel)
                await promoted.save()
            }
        }

        await clearChannelCache(...channels)
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

interface LocaledData {
    id: string
    name: string
}

async function parseI18nData(content: string) {
    const { teams, tournaments, lang } = JSON.parse(content) as {
        teams: LocaledData[]
        tournaments: LocaledData[]
        lang: string
    }

    //执行联赛更新
    for (const { id, name } of tournaments) {
        const tournament = await Tournament.findOne({
            where: {
                crown_tournament_id: id,
            },
            attributes: ['id', 'i18n_name'],
        })
        if (!tournament) continue

        if (tournament.i18n_name) {
            if (tournament.i18n_name[lang] === name) {
                continue
            }
            tournament.i18n_name = {
                ...tournament.i18n_name,
                [lang]: name,
            }
        } else {
            tournament.i18n_name = { [lang]: name }
        }
        await tournament.save()
    }

    //执行队伍更新
    for (const { id, name } of teams) {
        const team = await Team.findOne({
            where: {
                crown_team_id: id,
            },
            attributes: ['id', 'i18n_name'],
        })
        if (!team) continue

        if (team.i18n_name) {
            if (team.i18n_name[lang] === name) {
                continue
            }
            team.i18n_name = {
                ...team.i18n_name,
                [lang]: name,
            }
        } else {
            team.i18n_name = { [lang]: name }
        }
        await team.save()
    }
}

/**
 * 解析从队列得到的多语言数据
 */
async function startI18nData() {
    while (true) {
        const [promise] = consume('i18n_data', parseI18nData)
        await promise
    }
}

/**
 * 创建滚球4监测盘口
 */
async function createRockball4Odd(
    data: Pick<
        InferCreationAttributes<RockballOdd>,
        'match_id' | 'type' | 'condition' | 'period' | 'value' | 'crown_match_id'
    >,
) {
    //尝试寻找相同的盘口
    const odd = await RockballOdd.findOne({
        where: {
            match_id: data.match_id,
            variety: 'goal',
            period: data.period,
            type: data.type,
            condition: data.condition,
            channel: 'rockball4',
        },
    })
    if (!odd) {
        //盘口不存在就创建盘口
        await RockballOdd.create({
            match_id: data.match_id,
            crown_match_id: data.crown_match_id,
            source_variety: 'goal',
            source_period: data.period,
            source_condition: data.condition,
            source_type: data.type,
            source_value: '0',
            variety: 'goal',
            period: data.period,
            type: data.type,
            condition: data.condition,
            value: data.value,
            is_open: 1,
            channel: 'rockball4',
            source_channel: '',
            source_id: 0,
        })
    }
}

/**
 * 解析并处理皇冠热门比赛数据
 * @param content
 */
async function parseHotMatchesData(content: string) {
    const matches = JSON.parse(content) as Crown.MatchInfo[]

    for (const match of matches) {
        //插入比赛数据
        const [match_id] = await Match.prepare(match)

        //更新成为皇冠热门比赛的时间
        const [updated] = await Match.update(
            {
                crown_hot_at: new Date(),
            },
            {
                where: {
                    id: match_id,
                    crown_hot_at: null,
                },
                returning: false,
            },
        )

        //查询队伍数据
        const teams = await Team.findAll({
            where: {
                crown_team_id: {
                    [Op.in]: [match.team_id_h, match.team_id_c],
                },
            },
        })

        //检查是否有上半场进球的能力
        if (teams.some((t) => t.goal_period1)) {
            //有能力，插入到滚球4的上半场大0.5队列
            await createRockball4Odd({
                match_id,
                crown_match_id: match.ecid,
                type: 'over',
                condition: '0.5',
                period: 'period1',
                value: '2',
            })
        }

        if (updated) {
            //如果是新进入皇冠热门的比赛，那么进入滚球5判断
            await createRockball5(
                {
                    id: match_id,
                    crown_match_id: match.ecid,
                },
                'crown_hot',
            )
        }
    }
}

/**
 * 消费并处理皇冠热门比赛数据
 */
async function startCrownHotMatchesData() {
    while (true) {
        const [promise] = consume('crown_hot_matches', parseHotMatchesData)
        await promise
    }
}

if (require.main === module) {
    startCrownMatchesData()
    startCrownMatchesDataFake()
    startCrownScoreData()
    startI18nData()
    startCrownHotMatchesData()
}
