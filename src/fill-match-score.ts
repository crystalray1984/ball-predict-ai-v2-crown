import dayjs from 'dayjs'
import { groupBy } from 'lodash'
import { Op } from 'sequelize'
import { getOddResult } from './common/helpers'
import { Match, PromotedOdd, VMatch } from './db'
import { findMatch, getFinalMatches, getMatchScore } from './titan007'

/**
 * 填充所有比赛的赛果
 */
async function main() {
    //首先读取所有需要获取赛果的比赛
    const matches = await VMatch.findAll({
        where: {
            match_time: {
                [Op.lt]: dayjs().startOf('day').add(-1, 'days').toDate(),
            },
            has_score: 0,
        },
        order: ['match_time'],
    })

    console.log('需要获取赛果的比赛', matches.length)

    //按日期分组
    const groups = Object.values(groupBy(matches, (t) => dayjs(t.match_time).format('YYYYMMDD')))

    for (const group of groups) {
        if (group.length === 0) continue

        //日期
        const date = dayjs(group[0].match_time)

        //读取这个日期的完场赛事
        const finalData = await getFinalMatches(date)

        for (const match of group) {
            const found = findMatch(match, finalData)
            if (!found) {
                console.log(
                    '[无匹配]',
                    dayjs(match.match_time).format('YYYY-MM-DD HH:mm'),
                    match.team1_name,
                    match.team2_name,
                )
                continue
            }

            //读取完成比分
            const score = await getMatchScore(found.match_id, found.swap, true)

            console.log(
                '[匹配]',
                found.match_id,
                dayjs(match.match_time).format('YYYY-MM-DD HH:mm'),
                match.team1_name,
                match.team2_name,
            )

            //写入完场比分数据
            await Match.update(
                {
                    ...score,
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
                },
            })

            for (const odd of odds) {
                const result = getOddResult(odd, score)
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
}

main()
    .then(() => process.exit())
    .catch((err) => {
        console.error(err)
        process.exit()
    })
