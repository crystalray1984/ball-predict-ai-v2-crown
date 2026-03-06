import { getOddResult } from '@/common/helpers'
import { Match, Promoted } from '@/db'
import { Op } from 'sequelize'

async function main() {
    const matches: Record<number, Match> = {}

    const list = await Promoted.findAll({
        where: {
            value: {
                [Op.not]: null,
            },
            result: {
                [Op.not]: null,
            },
            result_value: null,
        },
        order: [['id', 'desc']],
    })

    for (const promoted of list) {
        let match = matches[promoted.match_id]
        if (!match) {
            const found = await Match.findByPk(promoted.match_id)
            if (!found) continue
            match = matches[promoted.match_id] = found
        }

        const result = getOddResult(promoted, match as any)
        if (!result) continue

        promoted.result_value = result.result_value
        promoted.result_profit = result.result_profit
        await promoted.save()
        console.log(promoted.id)
    }
}

main()
    .then(() => process.exit())
    .catch((err) => {
        console.error(err)
        process.exit()
    })
