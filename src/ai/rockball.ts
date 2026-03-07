import {
    QueueConfig,
    consume as rabbitmqConsume,
    publish as rabbitmqPublish,
} from '@/common/rabbitmq'
import { RateLimiter } from '@/common/rate-limiter'
import { CONFIG } from '@/config'
import { RockballOdd, VMatch } from '@/db'
import axios from 'axios'
import dayjs from 'dayjs'
import Decimal from 'decimal.js'

/**
 * 扣子滚球上半场大0.5判断工作流输入参数
 */
export interface CozeRockballInput {
    /**
     * 比赛id
     */
    match_id: number
    /**
     * 滚球盘口id
     */
    odd_id: number
}

/**
 * 队列定义
 */
const QUEUE: QueueConfig = {
    name: 'ai_coze_rockball',
    exchange: {
        type: 'x-delayed-message',
        arguments: {
            'x-delayed-type': 'direct',
        },
    },
}

/**
 * 把数据抛到AI处理队列
 * @param input
 * @param delay
 */
export function publish(input: CozeRockballInput, delay = 1) {
    return rabbitmqPublish(QUEUE, JSON.stringify(input), { headers: { 'x-delay': delay } })
}

/**
 * 扣子滚球上半场大0.5判断工作流开启消费
 */
export function consume() {
    const [promise] = rabbitmqConsume(QUEUE, async (content) => {
        const data = JSON.parse(content) as CozeRockballInput
        const processed = await process(data)
        if (!processed) {
            //如果解析不成功，那么重新抛回到队列
            await publish(data, 60)
        }
    })
    return promise
}

/**
 * 两次调用之间至少间隔1分钟
 */
const rateLimitter = new RateLimiter(60000)

interface CozeResult extends Record<string, any> {
    '上半场大0.5': string
}

interface CozeResponse {
    result: CozeResult
    detail: {
        error_message: string
    }
}

/**
 * 执行AI处理
 */
async function process(input: CozeRockballInput): Promise<boolean> {
    //读取滚球盘口信息
    let odd = await RockballOdd.findOne({
        where: {
            id: input.odd_id,
        },
    })
    if (!odd || !odd.is_open) return true

    //只对上半场大0.5的盘口进行处理
    if (odd.period !== 'period1' || odd.type !== 'over' || !Decimal(odd.condition).eq('0.5'))
        return true

    //查询比赛信息
    const match = await VMatch.findOne({
        where: {
            id: input.match_id,
        },
    })
    if (!match) return true

    //拆解联赛名称
    const tournament_name = match.tournament_i18n_name?.en || match.tournament_name

    //拆解队伍名称
    const team1_name = match.team1_i18n_name?.en || match.team1_name
    const team2_name = match.team2_i18n_name?.en || match.team2_name

    await rateLimitter.next()

    //调用接口进行AI分析
    const resp = await axios.request<CozeResponse>({
        method: 'POST',
        url: CONFIG.ai.rockball.url,
        headers: {
            Authorization: `Bearer ${CONFIG.ai.rockball.token}`,
        },
        data: {
            league: tournament_name,
            match_time: dayjs(match.match_time).format('YYYY/MM/DD HH:mm'),
            home_team: team1_name,
            away_team: team2_name,
        },
    })

    if (!resp.data.result || !resp.data.result['上半场大0.5']) {
        //无法解析得到信息
        console.error('rockball')
        console.error(resp.data)
        return false
    }

    //刷新一下盘口信息
    odd = await RockballOdd.findOne({
        where: {
            id: input.odd_id,
        },
    })
    //盘口信息不正常的就出去了
    if (!odd || odd.status !== '' || odd.note || !odd.is_open) return true

    //整理AI得到的信息
    const note = Object.entries(resp.data.result)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n')

    //根据解析结果进行盘口处理
    switch (resp.data.result['上半场大0.5']) {
        case '大':
            //维持大球
            await RockballOdd.update(
                {
                    note,
                },
                {
                    where: {
                        id: input.odd_id,
                    },
                    returning: false,
                },
            )
            break
        case '小':
            //改为小球
            await RockballOdd.update(
                {
                    back: 1,
                    note,
                },
                {
                    where: {
                        id: input.odd_id,
                    },
                    returning: false,
                },
            )
            break
        default:
            //解析结果不符合，这个盘口不推
            await RockballOdd.update(
                {
                    is_open: 0,
                    note,
                },
                {
                    where: {
                        id: input.odd_id,
                    },
                    returning: false,
                },
            )
            break
    }

    return true
}
