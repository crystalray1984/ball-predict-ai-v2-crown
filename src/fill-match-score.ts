import dayjs from 'dayjs'
import { groupBy } from 'lodash'
import { Op } from 'sequelize'
import { getOddResult } from './common/helpers'
import {
    Match,
    PromotedOdd,
    PromotedOddMansion,
    RockballPromoted,
    SurebetV2Promoted,
    VMatch,
} from './db'
import { findMatch, getFinalMatches, getMatchScore } from './titan007'

/**
 * 填充所有比赛的赛果
 */
async function main() {
    const fill = async (
        odd: PromotedOdd | SurebetV2Promoted | PromotedOddMansion | RockballPromoted,
    ) => {
        const match = await Match.findOne({
            where: {
                id: odd.match_id,
            },
        })
        if (!match) return
        if (odd.period === 'period1' && !match.has_period1_score) return
        if (odd.period === 'regularTime' && !match.has_score) return

        const result1 = getOddResult(odd, match as any)
        if (!result1) return
        odd.result = result1.result
        odd.score = result1.score
        odd.score1 = result1.score1
        odd.score2 = result1.score2
        await odd.save()
    }

    //首先读取所有需要获取赛果的盘口
    const odds = await PromotedOdd.findAll({
        where: {
            result: null,
        },
    })

    for (const odd of odds) {
        await fill(odd)
    }

    const odds2 = await SurebetV2Promoted.findAll({
        where: {
            result: null,
        },
    })

    for (const odd of odds2) {
        await fill(odd)
    }

    const odds3 = await PromotedOddMansion.findAll({
        where: {
            result: null,
        },
    })

    for (const odd of odds3) {
        await fill(odd)
    }

    const odds4 = await RockballPromoted.findAll({
        where: {
            result: null,
        },
    })

    for (const odd of odds4) {
        await fill(odd)
    }
}

main()
    .then(() => process.exit())
    .catch((err) => {
        console.error(err)
        process.exit()
    })
