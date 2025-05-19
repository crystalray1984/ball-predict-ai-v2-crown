import { runLoop } from '@/common/helpers'
import { getCrownMatches } from '@/crown'
import { Match } from '@/db'

/**
 * 开启皇冠比赛列表抓取
 */
export function startCrownMatches() {
    //每半个小时抓取一次
    return runLoop(1800000, async () => {
        //开始抓取皇冠比赛列表
        const matches = await getCrownMatches()

        console.log('采集到比赛数据', matches.length)

        //插入比赛数据
        let newCount = 0
        for (const match of matches) {
            const [_, isNew] = await Match.prepare(match)
            if (isNew) {
                newCount++
            }
        }
        console.log(`新增比赛数据`, newCount)
    })
}

if (require.main === module) {
    startCrownMatches()
}
