import { getCrownMatches, init } from '@/crown'
import { getTodayMatches } from '@/crown/match'

async function main() {
    await init()
    const matches = await getTodayMatches()

    matches.forEach((match) => {
        const { match_time, ...rest } = match
        console.log({
            ...rest,
            match_time: new Date(match_time),
        })
    })
}

main()
