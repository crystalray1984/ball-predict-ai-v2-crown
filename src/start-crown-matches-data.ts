import { close, consume } from '@/common/rabbitmq'
import { CONFIG } from '@/config'
import { Match } from '@/db'

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
        await close()
    }
}

if (require.main === module) {
    startCrownMatchesData()
}
