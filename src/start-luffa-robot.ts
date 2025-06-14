import { getNumberWithSymbol, runLoop } from '@/common/helpers'
import { LuffaMessage, receiveMsg, sendGroupMsg, sendSingleMsg } from '@/common/luffa'
import { close, consume, publish } from '@/common/rabbitmq'
import { db, LuffaUser, VLuffaUser, VPromotedOdd } from '@/db'
import dayjs from 'dayjs'
import { Op } from 'sequelize'

/**
 * 接收来自Luffa的消息
 */
async function receiveLuffaMsg() {
    const groups = await receiveMsg()

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
            if (messages.some((t) => t.text === '' && typeof t.name === 'string')) {
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
#BallPredictAI`,
                        },
                    }),
                )
            }
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

        //发送消息
        if (message.is_group) {
            //发送群聊消息
            await sendGroupMsg(message.uid, message.msg_type, message.msg)
        } else {
            //发送单聊消息
            await sendSingleMsg(message.uid, message.msg.text)
        }
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
 * 处理最终推荐的推送消息
 * @param content
 */
async function processSendPromoted(content: string) {
    const { id } = JSON.parse(content) as { id: number }

    //查询推荐盘口信息
    const promoted = await VPromotedOdd.findOne({
        where: {
            id,
        },
    })

    if (!promoted) return

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

    if (users.length === 0) return

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

    //构建队列数据
    const queueData = users.map(({ uid }) =>
        JSON.stringify({
            uid,
            is_group: false,
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
        const [promise] = consume('send_promoted', processSendPromoted)
        await promise
        await close()
    }
}

if (require.main === module) {
    runLoop(1000, receiveLuffaMsg)
    startLuffaMessageQueue()
    startPromotedQueue()
}
