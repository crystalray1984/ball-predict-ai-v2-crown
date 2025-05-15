import { RateLimiter } from '@/common/rate-limiter'
import { getCrownData, getCrownMatches, init } from '@/crown'
import { Match, Odd } from '@/db'
import Decimal from 'decimal.js'
import { startConsumer } from './common/rabbitmq'
import { getSetting } from './common/settings'
import { findMatchedOdd } from './crown/odd'
import { runLoop } from './common/helpers'

/**
 * 开始抓取皇冠比赛数据
 */
function processCrownMatches() {
    //每半个小时抓取一次
    runLoop(1800000, async () => {
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

/**
 * 处理消息队列上收到的surebet数据
 */
async function processSurebet(surebet: Surebet.Output) {
    //首先确定比赛的状态
    const match = await Match.findOne({
        where: {
            crown_match_id: surebet.crown_match_id,
        },
    })
    if (match && match.status !== '') {
        //不是待准备的比赛就不处理了
        return
    }

    let odd = await Odd.findOne({
        where: {
            crown_match_id: surebet.crown_match_id,
            variety: surebet.type.variety,
            period: surebet.type.period,
            condition: surebet.type.condition,
            type: surebet.type.type,
        },
    })
    if (odd && odd.status !== '') return

    //读取比赛的皇冠盘口
    const data = await getCrownData(surebet.crown_match_id)
    if (!data) {
        //没有盘口数据，跳过
        return
    }

    //寻找与当前盘口匹配的盘口
    const matchedOdd = findMatchedOdd(surebet.type, data.odds).find(
        (t) => t.condition === surebet.type.condition,
    )
    if (!matchedOdd) {
        //第一次比对失败，因为没找到对应的盘口，直接抛弃掉
        return
    }

    //找到了对应的盘口，就对水位进行判断
    const ready_condition = await getSetting<string>('ready_condition')

    const status = Decimal(matchedOdd.value).sub(surebet.surebet_value).gte(ready_condition!)
        ? 'ready'
        : ''

    //写入匹配结果
    if (odd) {
        odd.status = status
        odd.surebet_value = surebet.surebet_value
        odd.crown_value = matchedOdd.value
        await odd.save()
    } else {
        const [match_id] = await Match.prepare({
            ...data.match,
            match_time: surebet.match_time,
            ecid: surebet.crown_match_id,
        })

        await Odd.create({
            match_id,
            crown_match_id: surebet.crown_match_id,
            variety: surebet.type.variety,
            period: surebet.type.period,
            condition: surebet.type.condition,
            type: surebet.type.type,
            surebet_value: surebet.surebet_value,
            crown_value: matchedOdd.value,
            status,
        })
    }
}

/**
 * 处理临近开场的比赛
 */
async function processNearlyMatches() {}

/**
 * 开启皇冠数据抓取
 */
export async function startCrown() {
    //首先初始化皇冠环境
    await init()

    //开启比赛数据抓取
    runLoop(1800000, processCrownMatches)

    //处理临近开场的比赛
    runLoop(30000, processNearlyMatches)

    //开启消息队列做第一次数据比对
    startConsumer('ready_check', async (jsonStr) => {
        const data = JSON.parse(jsonStr)
        console.log(data)
        await processSurebet(data)
    })
}

if (require.main === module) {
    startCrown()
}
