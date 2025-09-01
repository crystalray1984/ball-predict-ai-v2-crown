import { getNumberWithSymbol, runLoop } from '@/common/helpers'
import {
    LuffaMessage,
    LuffaMessageGroup,
    receiveMsg,
    sendGroupMsg,
    sendSingleMsg,
} from '@/common/luffa'
import { close, consume, publish } from '@/common/rabbitmq'
import {
    db,
    LuffaUser,
    NotificationLog,
    VLuffaUser,
    VPromotedOdd,
    VPromotedOddChannel2,
} from '@/db'
import dayjs from 'dayjs'
import { Op } from 'sequelize'
import { getSetting } from './common/settings'
import { CONFIG } from './config'

/**
 * 接收来自Luffa的消息
 */
async function receiveLuffaMsg() {
    let groups: LuffaMessageGroup[]
    try {
        groups = await receiveMsg()
    } catch {
        return
    }

    if (!Array.isArray(groups) || groups.length === 0) {
        return
    }

    for (const group of groups) {
        if (group.type === 0) {
            //是普通用户
            try {
                await LuffaUser.findOrCreate({
                    where: {
                        uid: group.uid,
                    },
                    defaults: {
                        uid: group.uid,
                        type: group.type,
                        open_push: 1,
                    },
                    attributes: ['uid'],
                })
            } catch (err) {
                console.error(err)
            }

            const messages = group.message.map<LuffaMessage>((str) => JSON.parse(str))

            //判断有没有新关注的消息
            if (messages.some((t) => typeof t.name === 'string')) {
                //新关注的用户
                await publish(
                    'send_luffa_message',
                    JSON.stringify({
                        uid: group.uid,
                        is_group: false,
                        msg: {
                            text: `你好！我是BallPredictAI⚽️
为你带来“AI精准分析”的足球赛事推荐！
赛前3分钟推送关键预测消息。
订阅会员，即刻接收赛事推荐！
https://callup.luffa.im/superbox/mpy0grtc2k7x68fx`,
                        },
                    }),
                )
            }
        } else {
            //群消息，记录日志
            const messages = group.message.map<LuffaMessage>((str) => JSON.parse(str))
            console.log('收到群消息', messages)
        }
    }
}

/**
 * 监听需要发送到luffa的消息
 */
async function processLuffaSendMessage(content: string) {
    try {
        const message: {
            uid: string
            is_group: boolean
            msg: Record<string, any>
            msg_type: number
        } = JSON.parse(content)

        console.log('发送消息到Luffa', message)

        //发送消息
        let resp: string
        if (message.is_group) {
            //发送群聊消息
            resp = await sendGroupMsg(message.uid, message.msg_type, message.msg)
        } else {
            //发送单聊消息
            resp = await sendSingleMsg(message.uid, message.msg.text)
        }

        console.log(resp)
    } catch (err) {
        console.error('发送Luffa消息异常', content)
        console.error(err)
        throw err
    }
}

/**
 * 监听要通过luffa发送的消息队列
 */
async function startLuffaMessageQueue() {
    while (true) {
        const [promise] = consume('send_luffa_message', processLuffaSendMessage, {
            prefetchCount: 5,
        })
        await promise
        await close()
    }
}

/**
 * 根据推荐的盘口生成Luffa推荐文本内容
 */
function createPromotionMessage(promoted: VPromotedOdd) {
    const oddParts: string[] = []
    if (promoted.variety === 'corner') {
        oddParts.push('角球')
    }
    oddParts.push(promoted.period === 'period1' ? '半场' : '全场')
    switch (promoted.type) {
        case 'ah1':
            oddParts.push('主胜')
            oddParts.push(getNumberWithSymbol(promoted.condition))
            break
        case 'ah2':
            oddParts.push('客胜')
            oddParts.push(getNumberWithSymbol(promoted.condition))
            break
        case 'over':
            oddParts.push('大球')
            oddParts.push(parseFloat(promoted.condition).toString())
            break
        case 'under':
            oddParts.push('小球')
            oddParts.push(parseFloat(promoted.condition).toString())
            break
        case 'draw':
            oddParts.push('平局')
            break
    }

    //构建抛入到下一个队列的数据
    const text = `**比赛推荐**
${dayjs(promoted.match_time).format('M/D HH:mm')} UTC+8
${promoted.tournament_name}
${promoted.team1_name}
${promoted.team2_name}

${oddParts.join(' ')}`

    return text
}

/**
 * 将推荐消息发送给处于有效期内的会员
 */
async function sendVipPromotionMessage(promoted: VPromotedOdd) {
    //查询要推送的用户列表
    const users = await VLuffaUser.findAll({
        where: {
            status: 1,
            expire_time: {
                [Op.gt]: db.literal('CURRENT_TIMESTAMP'),
            },
        },
        attributes: ['uid'],
    })

    console.log('推送推荐信息', promoted.id, '目标数=', users.length)

    if (users.length === 0) return

    //构建抛入到下一个队列的数据
    const text = createPromotionMessage(promoted)

    //构建队列数据
    const queueData = users.map(({ uid }) =>
        JSON.stringify({
            uid,
            is_group: false,
            msg: { text },
        }),
    )

    console.log('推送推荐信息', promoted.id, text)

    await publish('send_luffa_message', queueData)
}

/**
 * 将推荐消息发送到群
 */
async function sendGroupPromotionMessage(promoted: VPromotedOdd) {
    //先读取推荐配置
    const { promotion_luffa_targets, promotion_luffa_ratio, promotion_luffa_interval } =
        await getSetting(
            'promotion_luffa_targets',
            'promotion_luffa_ratio',
            'promotion_luffa_interval',
        )

    //先抛一个随机数确定是否要推荐这场比赛
    const pass = Math.random() <= promotion_luffa_ratio

    //随机数没过就不推荐
    if (!pass) return

    if (!Array.isArray(promotion_luffa_targets) || promotion_luffa_targets.length === 0) {
        //没有推荐的目标也不推荐
        return
    }

    //然后判断是否最近已经有过推荐了
    const has_notification = await NotificationLog.findOne({
        where: {
            category: 'group_promotion',
            created_at: {
                [Op.gte]: new Date(Date.now() - promotion_luffa_interval),
            },
        },
        attributes: ['id'],
    })

    if (has_notification) {
        //最近有推荐，也不推了
        return
    }

    //写入推荐记录
    await NotificationLog.create({
        keyword: `group_promotion:${promoted.id}`,
        category: 'group_promotion',
    })

    //构建推荐的文字
    let text = createPromotionMessage(promoted)
    text = `${text}
如需更多赛事推荐，请关注小程序 https://callup.luffa.im/superbox/mpy0grtc2k7x68fx`

    //发送推荐消息
    const queueData = promotion_luffa_targets.map(({ uid, type }) =>
        JSON.stringify({
            uid,
            is_group: type === 1,
            msg_type: 1,
            msg: { text },
        }),
    )

    console.log('推送推荐信息', promoted.id, text)

    await publish('send_luffa_message', queueData)
}

/**
 * 处理最终推荐的推送消息
 * @param content
 */
async function processSendPromoted(content: string) {
    const { id } = JSON.parse(content) as { id: number }
    console.log('推送推荐信息', id)

    //查询推荐盘口信息
    const promoted = await VPromotedOdd.findOne({
        where: {
            id,
        },
    })

    if (!promoted) return

    await sendVipPromotionMessage(promoted)
    try {
        await sendGroupPromotionMessage(promoted)
    } catch (err) {
        console.error(err)
    }
}

/**
 * 处理最终推荐的推送消息到通道2
 * @param content
 */
async function processSendPromotedChannel2(content: string) {
    const { id } = JSON.parse(content) as { id: number }
    console.log('推送推荐信息到通道2', id)

    //查询推荐盘口信息
    const promoted = await VPromotedOddChannel2.findOne({
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
 * 监听最终推荐消息推送
 */
async function startPromotedQueue() {
    while (true) {
        const [promise] = consume('send_promoted', processSendPromoted, { noLocal: false })
        await promise
        await close()
    }
}

/**
 * 监听最终推荐消息通道2推送
 */
async function startPromotedQueueChannel2() {
    while (true) {
        const [promise] = consume('send_promoted_channel2', processSendPromotedChannel2, {
            noLocal: false,
        })
        await promise
        await close()
    }
}

if (require.main === module) {
    runLoop(1000, receiveLuffaMsg)
    startLuffaMessageQueue()
    startPromotedQueue()
    startPromotedQueueChannel2()
}
