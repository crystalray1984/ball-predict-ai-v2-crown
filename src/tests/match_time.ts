import { getOddResult } from '@/common/helpers'
import { Match, Promoted, RockballOdd } from '@/db'
import { Op } from 'sequelize'
import * as ai from '@/ai'

const rows = [
    { match_id: 21884, odd_id: 5125 },
    { match_id: 22371, odd_id: 5113 },
    { match_id: 22481, odd_id: 5152 },
    { match_id: 22521, odd_id: 5129 },
    { match_id: 22528, odd_id: 5131 },
    { match_id: 22534, odd_id: 5141 },
    { match_id: 22518, odd_id: 5162 },
    { match_id: 22540, odd_id: 5127 },
    { match_id: 22523, odd_id: 5135 },
    { match_id: 22543, odd_id: 5137 },
    { match_id: 21891, odd_id: 5153 },
    { match_id: 22527, odd_id: 5133 },
    { match_id: 22405, odd_id: 5146 },
    { match_id: 20965, odd_id: 5156 },
    { match_id: 22360, odd_id: 5159 },
    { match_id: 19624, odd_id: 5160 },
    { match_id: 19625, odd_id: 5132 },
    { match_id: 21749, odd_id: 5155 },
    { match_id: 21325, odd_id: 5154 },
    { match_id: 19180, odd_id: 5138 },
    { match_id: 19180, odd_id: 5158 },
    { match_id: 20509, odd_id: 5157 },
    { match_id: 19629, odd_id: 5143 },
    { match_id: 22421, odd_id: 5161 },
    { match_id: 22401, odd_id: 5136 },
    { match_id: 22399, odd_id: 5145 },
    { match_id: 19184, odd_id: 5144 },
    { match_id: 21742, odd_id: 5149 },
    { match_id: 19652, odd_id: 5142 },
    { match_id: 21825, odd_id: 5148 },
    { match_id: 19650, odd_id: 5147 },
]

async function main() {
    for (const row of rows) {
        await ai.rockball.publish(row)
        console.log(row)
    }
}

main()
    .then(() => process.exit())
    .catch((err) => {
        console.error(err)
        process.exit()
    })
