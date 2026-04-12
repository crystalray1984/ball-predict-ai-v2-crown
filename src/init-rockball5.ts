import { Match, MatchTeamInfo, Promoted, VPromoted } from '@/db'
import { Op } from 'sequelize'
import { getOddResult } from './common/helpers'
import { calculateCoefficient } from './common/rockball'

async function main() {
    //重建滚球5数据
    let lastPromotedId = 0
    while (true) {
        const list = await Match.findAll({
            where: {
                has_score: 1,
                id: {
                    [Op.gt]: lastPromotedId,
                },
            },
            order: [['id', 'asc']],
            limit: 100,
        })

        if (list.length === 0) break

        for (const source of list) {
            console.log(source.id)
            lastPromotedId = source.id

            //先检查是否有重复的
            const exists = await Promoted.findOne({
                where: {
                    match_id: source.id,
                    channel: 'rockball5',
                },
                attributes: ['id'],
            })
            if (exists) continue

            //检查比赛的对阵双方信息
            const matchInfo = await MatchTeamInfo.findByPk(source.id)

            //没有数据的不要
            if (!matchInfo || !matchInfo.team1_info || !matchInfo.team2_info) continue

            //没有比赛数据的不要
            if (matchInfo.team1_info.matches < 2 || matchInfo.team2_info.matches < 2) continue

            //计算系数
            const ratio = calculateCoefficient(matchInfo.team1_info, matchInfo.team2_info)

            //系数小于2的不要
            if (ratio.lt(2)) continue

            //计算赛果和手数
            const result = getOddResult(
                {
                    variety: 'goal',
                    period: 'period1',
                    type: 'over',
                    condition: '0.5',
                    value: '1.88',
                },
                {
                    score1: source.score1_period1!,
                    score2: source.score2_period1!,
                    score1_period1: source.score2_period1!,
                    score2_period1: source.score2_period1!,
                } as any,
            )!

            //插入数据
            await Promoted.create({
                match_id: source.id,
                source_type: '',
                source_id: 0,
                channel: 'rockball5',
                is_valid: 1,
                week_day: 0,
                week_id: 0,
                variety: 'goal',
                period: 'period1',
                type: 'over',
                odd_type: 'sum',
                condition: '0.5',
                value: '1.88',
                score: (source.score1_period1! + source.score2_period1!).toString(),
                score1: source.score1_period1,
                score2: source.score2_period1,
                result: result.result,
                result_profit: result.result_profit,
                result_value: result.result_value,
            })
        }
    }
}

main()
    .then(() => process.exit())
    .catch((err) => {
        console.error(err)
        process.exit()
    })
