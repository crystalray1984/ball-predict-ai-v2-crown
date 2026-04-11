import { Match, MatchTeamInfo } from '@/db'
import { getTeamInfo } from '@/db/models/Match'
import { Op } from 'sequelize'

async function main() {
    //计算比赛对阵双方数据
    let lastMatchId = 0
    while (true) {
        const matches = await Match.findAll({
            where: {
                id: {
                    [Op.gt]: lastMatchId,
                },
            },
            order: [['id', 'ASC']],
            limit: 200,
            attributes: ['id', 'match_time', 'team1_id', 'team2_id'],
        })

        if (matches.length === 0) {
            break
        }

        for (const match of matches) {
            lastMatchId = match.id
            const team1_info = await getTeamInfo(match.team1_id, match.match_time.valueOf())
            const team2_info = await getTeamInfo(match.team2_id, match.match_time.valueOf())

            const data = {
                match_id: match.id,
                team1_info,
                team2_info,
            }

            //更新实力数据
            await MatchTeamInfo.upsert(data, { returning: false })

            console.log(match.id)
        }
    }
}

main()
    .then(() => process.exit())
    .catch((err) => {
        console.error(err)
        process.exit()
    })
