import dayjs from 'dayjs'
import Decimal from 'decimal.js'
import { InferAttributes } from 'sequelize'
import { sendSocketMessage } from './common/api'
import { getNumberWithSymbol, isDecimal } from './common/helpers'
import { getLabelInfo } from './common/label'
import { close, consume, publish } from './common/rabbitmq'
import { CONFIG, LuffaNotificationConfig } from './config'
import { VLabelPromoted, VPromoted } from './db'

type VPromotedData = Pick<
    InferAttributes<VPromoted>,
    | 'type'
    | 'period'
    | 'team1_name'
    | 'team2_name'
    | 'condition'
    | 'value'
    | 'match_time'
    | 'tournament_name'
    | 'week_id'
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
            oddParts.push('平')
            break
    }

    if (isDecimal(promoted.value)) {
        oddParts.push(`@${Decimal(promoted.value).toFixed(2).toString()}`)
    }

    //构建抛入到下一个队列的数据
    let text = `${dayjs(promoted.match_time).format('YYYY-MM-DD HH:mm')}

${promoted.tournament_name}

${promoted.team1_name}

${promoted.team2_name}

${promoted.period === 'period1' ? '半场' : '全场'}

${oddParts.join(' ')}
`

    if (promoted.week_id) {
        text = `=====${promoted.week_id}=====

${text}`
    }

    return text
}

/**
 * 处理推送到群和用户的推荐消息
 * @param content
 */
async function processSendPromoted(content: string) {
    const { id, type } = JSON.parse(content) as { id: number; type: string }
    console.log('推送推荐信息', id, type)

    let promoted: VPromoted | VLabelPromoted | null
    if (type === 'label_promoted') {
        //标签推荐
        promoted = await VLabelPromoted.findOne({
            where: {
                id,
                is_valid: 1,
            },
        })
    } else {
        //其他推荐
        promoted = await VPromoted.findOne({
            where: {
                id,
                is_valid: 1,
            },
        })
    }

    if (!promoted) return

    //要推送到Luffa的消息内容
    const text = createPromotionMessage(promoted)
    //推送到Luffa的目标
    let target: LuffaNotificationConfig[] = []
    //WS推送的目标类型
    let socket_type = ''

    //根据不同的推送类型，发送到不同的地方
    switch (promoted.channel) {
        //直通规则
        case 'direct':
            socket_type = 'manual'
            break
        //mansion对比
        case 'mansion':
            target = CONFIG.luffa.mansion
            socket_type = 'compare'
            break
        //滚球
        case 'rockball':
            target = CONFIG.luffa.rockball
            socket_type = 'rockball'
            break
        //总台
        case 'generic':
            target = CONFIG.luffa.notification_channel2
            break
        //新老融合
        case 'v2_to_v3':
            target = CONFIG.luffa.surebet_v2_to_v3
            break
        //联赛标签
        case 'label_promoted':
            const label = await getLabelInfo(promoted.tournament_label_id)
            if (!label) return
            target = [
                {
                    uid: label.luffa_uid,
                    type: label.luffa_type,
                },
            ]
            break
        default:
            return
    }

    //抛到Luffa发送队列
    if (Array.isArray(target) && target.length > 0) {
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
    }

    //通过WS发送
    if (socket_type) {
        await sendSocketMessage({
            type: 'group',
            target: 'vip',
            message: {
                type: 'promote',
                sub_type: socket_type,
                data: {
                    id: promoted.id,
                    match_id: promoted.match_id,
                    match_time: promoted.match_time,
                    variety: promoted.variety,
                    period: promoted.period,
                    type: promoted.type,
                    condition: promoted.condition,
                    value: promoted.value,
                    tournament: {
                        id: promoted.tournament_id,
                        name: promoted.tournament_name,
                    },
                    team1: {
                        id: promoted.team1_id,
                        name: promoted.team1_name,
                    },
                    team2: {
                        id: promoted.team2_id,
                        name: promoted.team2_name,
                    },
                    result:
                        typeof promoted.result === 'number'
                            ? {
                                  result: promoted.result,
                                  score1: promoted.score1,
                                  score2: promoted.score2,
                                  score: promoted.score,
                              }
                            : null,
                },
            },
        })
    }
}

/**
 * 监听最终推荐消息通道2推送
 */
async function startPromoted() {
    while (true) {
        const [promise] = consume(CONFIG.queues['send_promoted'], processSendPromoted, {
            noLocal: false,
        })
        await promise
        await close()
    }
}

if (require.main === module) {
    startPromoted()
}
