import { getNumberWithSymbol, isEmpty } from '@/common/helpers'
import { close, consume, publish } from '@/common/rabbitmq'
import { VPromotedOdd } from '@/db'
import dayjs from 'dayjs'
import Decimal from 'decimal.js'
import { CONFIG } from './config'

/**
 * 根据推荐的盘口生成Luffa推荐文本内容
 */
function createPromotionMessage(promoted: VPromotedOdd) {
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
    const text = `=====${promoted.id}=====

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
 * 处理最终推荐的推送消息到通道2
 * @param content
 */
async function processSendPromotedChannel2(content: string) {
    const { id } = JSON.parse(content) as { id: number }
    console.log('推送推荐信息到通道2', id)

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

/**
 * 监听最终推荐消息通道2推送
 */
async function startPromotedQueueChannel2() {
    while (true) {
        const [promise] = consume(
            CONFIG.queues['send_promoted_channel2'],
            processSendPromotedChannel2,
            {
                noLocal: false,
            },
        )
        await promise
        await close()
    }
}

if (require.main === module) {
    startPromotedQueueChannel2()
}
