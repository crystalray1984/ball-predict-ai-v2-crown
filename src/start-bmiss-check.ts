import { Op } from 'sequelize'
import { parseMainOddForBmiss } from './common/bmiss'
import { runLoop } from './common/helpers'
import { consume, publish } from './common/rabbitmq'
import { Match } from './db'

/**
 * 检查需要抛到皇冠盘口采集队列的比赛
 */
async function startBmissMatchesCheck() {
    //比赛时间在未来24小时内，且未开赛，而且比赛上有允许投注的标签
    const matches = await Match.findAll({
        where: {
            bmiss_bet_enable: 1,
            match_time: {
                [Op.between]: [new Date(), new Date(Date.now() + 86400000)],
            },
        },
        attributes: ['id', 'crown_match_id'],
    })

    console.log('需要采集bmiss盘口的比赛数量', matches.length)

    if (matches.length === 0) return

    //抛到皇冠盘口采集队列中
    //把数据抛入队列
    await publish(
        'crown_odd',
        matches.map((match) => {
            return JSON.stringify({
                next: 'bmiss_check',
                crown_match_id: match.crown_match_id,
                extra: {
                    match_id: match.id,
                },
            })
        }),
        undefined,
        { maxPriority: 20 },
    )
}

/**
 * 开启Bmiss盘口采集队列消费者
 */
async function startBmissCheckConsumer() {
    const [promise] = consume('bmiss_check', async (content) => {
        const data = JSON.parse(content) as CrownRobot.Output<{
            match_id: number
        }>
        if (!data.data || !data.extra) return

        //检查比赛状态和比赛时间
        const match = await Match.findOne({
            where: {
                id: data.extra.match_id,
            },
            attributes: ['match_time', 'bmiss_bet_enable'],
        })
        if (!match) return
        if (!match.bmiss_bet_enable) return
        if (match.match_time.valueOf() <= Date.now()) return

        await parseMainOddForBmiss(data)
    })
    await promise
}

if (require.main === module) {
    //每5分钟处理一次，检查现在需要采集盘口的比赛
    runLoop(300000, startBmissMatchesCheck)
    startBmissCheckConsumer()
}
