import { getCrownData, init } from './crown'

async function main() {
    const crown_match_id = (() => {
        if (process.argv.length < 3) return ''
        for (let i = 2; i < process.argv.length; i++) {
            const arg = process.argv[i]
            if (/^[0-9]+$/.test(arg)) {
                return arg
            }
        }
        return ''
    })()

    if (!crown_match_id) {
        console.log('无效的皇冠比赛ID')
        return
    }

    await init()
    const data = await getCrownData(crown_match_id, 'today')
    console.log(data)
}

main()
    .catch((err) => {
        console.error(err)
    })
    .finally(() => {
        process.exit()
    })
