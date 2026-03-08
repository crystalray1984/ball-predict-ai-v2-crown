import { getOddResult } from '@/common/helpers'
import { Match, Promoted, RockballOdd } from '@/db'
import { Op } from 'sequelize'
import * as ai from '@/ai'

const rows = [
    { match_id: 22661, odd_id: 5249 },
    { match_id: 21787, odd_id: 5251 },
    { match_id: 21264, odd_id: 5256 },
    { match_id: 22716, odd_id: 5257 },
    { match_id: 22555, odd_id: 5259 },
    { match_id: 22374, odd_id: 5261 },
    { match_id: 22373, odd_id: 5262 },
    { match_id: 22547, odd_id: 5263 },
    { match_id: 22474, odd_id: 5264 },
    { match_id: 22194, odd_id: 5265 },
    { match_id: 22156, odd_id: 5266 },
    { match_id: 21796, odd_id: 5267 },
    { match_id: 20516, odd_id: 5268 },
    { match_id: 20516, odd_id: 5269 },
    { match_id: 21826, odd_id: 5271 },
    { match_id: 22203, odd_id: 5272 },
    { match_id: 22549, odd_id: 5273 },
    { match_id: 22193, odd_id: 5274 },
    { match_id: 21862, odd_id: 5276 },
    { match_id: 22705, odd_id: 5277 },
    { match_id: 22383, odd_id: 5278 },
    { match_id: 22379, odd_id: 5279 },
    { match_id: 21865, odd_id: 5280 },
    { match_id: 22739, odd_id: 5281 },
    { match_id: 20970, odd_id: 5282 },
    { match_id: 22554, odd_id: 5283 },
    { match_id: 22086, odd_id: 5285 },
    { match_id: 22742, odd_id: 5286 },
    { match_id: 21605, odd_id: 5287 },
    { match_id: 20975, odd_id: 5288 },
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
