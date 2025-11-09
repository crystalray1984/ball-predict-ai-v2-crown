import { getNumberWithSymbol, isEmpty } from '@/common/helpers'
import { close, consume, publish } from '@/common/rabbitmq'
import { VPromotedOdd, VSurebetV2Promoted } from '@/db'
import dayjs from 'dayjs'
import Decimal from 'decimal.js'
import { CONFIG } from './config'

type VPromotedData = Pick<
    VPromotedOdd,
    | 'type'
    | 'team1_name'
    | 'team2_name'
    | 'condition'
    | 'value'
    | 'week_id'
    | 'match_time'
    | 'tournament_name'
>

/**
 * 根据推荐的盘口生成Luffa推荐文本内容
 */
function createPromotionMessage(promoted: VPromotedData) {
    const oddParts: string[] = []
    // if (promoted.variety === 'corner') {
    //     oddParts.push('角球')
    // }
    // oddParts.push(promoted.period === 'period1' ? '半场' : '全场')
    switch (promoted.type) {
        case 'ah1':
            oddParts.push(promoted.team1_name)
            oddParts.push(getNumberWithSymbol(promoted.condition))
            break
        case 'ah2':
            oddParts.push(promoted.team2_name)
            oddParts.push(getNumberWithSymbol(promoted.condition))
            break
        case 'over':
            oddParts.push('大')
            oddParts.push(parseFloat(promoted.condition).toString())
            break
        case 'under':
            oddParts.push('小')
            oddParts.push(parseFloat(promoted.condition).toString())
            break
        case 'draw':
            oddParts.push('平局')
            break
    }

    if (!isEmpty(promoted.value)) {
        oddParts.push(`@`, Decimal(promoted.value).toString())
    }

    //构建抛入到下一个队列的数据
    const text = `=====${promoted.week_id}=====

${dayjs(promoted.match_time).format('YYYY-MM-DD HH:mm')}

${promoted.tournament_name}

${promoted.team1_name}

${promoted.team2_name}

全场

${oddParts.join('')}
`

    return text
}

/**
 * 处理推送到群和用户的推荐消息
 * @param content
 */
async function processSendPromoted(content: string) {
    const { id, type } = JSON.parse(content) as { id: number; type?: string }
    console.log('推送推荐信息', id, type)

    if (type === 'surebet_v2_promoted') {
        //新老系统surebet数据推荐
        const promoted = await VSurebetV2Promoted.findOne({
            where: {
                id,
            },
        })

        if (!promoted) return

        //构建抛入到下一个队列的数据
        const text = createPromotionMessage(promoted)

        const target = CONFIG.luffa.surebet_v2_to_v3

        if (!Array.isArray(target) || target.length === 0) return

        //构建队列数据
        const queueData = target.map(({ uid, type }) =>
            JSON.stringify({
                uid,
                is_group: type === 1,
                msg_type: 1,
                msg: { text },
            }),
        )

        await publish('send_luffa_message', queueData)
    } else {
        //查询推荐盘口信息
        const promoted = await VPromotedOdd.findOne({
            where: {
                id,
            },
        })

        if (!promoted) return

        //构建抛入到下一个队列的数据
        const text = createPromotionMessage(promoted)

        const channel2 = CONFIG.luffa.notification_channel2

        if (!Array.isArray(channel2) || channel2.length === 0) return

        //构建队列数据
        const queueData = channel2.map(({ uid, type }) =>
            JSON.stringify({
                uid,
                is_group: type === 1,
                msg_type: 1,
                msg: { text },
            }),
        )

        await publish('send_luffa_message', queueData)
    }
}

/**
 * 监听最终推荐消息通道2推送
 */
async function startPromotedQueueChannel2() {
    while (true) {
        const [promise] = consume(CONFIG.queues['send_promoted'], processSendPromoted, {
            noLocal: false,
        })
        await promise
        await close()
    }
}

if (require.main === module) {
    startPromotedQueueChannel2()
}
