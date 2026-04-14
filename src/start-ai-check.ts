import Decimal from 'decimal.js'
import { clearChannelCache } from './common/helpers'
import { close, consume, publish } from './common/rabbitmq'
import { CONFIG } from './config'
import { findMatchedOdd } from './crown'
import { AiPromoted, Match, Promoted } from './db'

/**
 * 检查皇冠队列回传的AI数据
 */
async function processAiPromotedCheck(input: CrownRobot.Output<{ id: number }>) {
    const { data, extra } = input
    if (!data || !extra) return

    //查询AI推荐数据
    const aiRow = await AiPromoted.findByPk(extra.id)
    if (!aiRow) {
        //数据不存在
        return
    }

    //判断比赛状态，距离开赛时间不能少于5分钟
    const match = await Match.findByPk(aiRow.match_id, {
        attributes: ['id', 'match_time'],
    })
    if (!match) return
    if (match.match_time.valueOf() - Date.now() < 300000) return

    //寻找对应的盘口
    const odd = findMatchedOdd(
        {
            variety: 'goal',
            period: aiRow.period,
            type: aiRow.type,
            condition: aiRow.condition.toString(),
        },
        data.odds,
    ).find((t) => Decimal(t.condition).eq(aiRow.condition))

    if (!odd) {
        //没有对应的盘口
        return
    }

    //写入推荐数据
    const channel = `ai_${aiRow.odd_type}`

    //判断推荐是否存在
    const exists = await Promoted.findOne({
        where: {
            channel,
            match_id: aiRow.match_id,
            period: aiRow.period,
        },
        attributes: ['id'],
    })
    if (exists) return

    //创建推荐
    const promoted = await Promoted.create({
        match_id: aiRow.match_id,
        source_type: 'ai_promoted',
        source_id: aiRow.id,
        channel: 'channel',
        is_valid: 1,
        skip: '',
        week_day: 0,
        week_id: 0,
        variety: 'goal',
        period: aiRow.period,
        type: aiRow.type,
        condition: aiRow.condition.toString(),
        odd_type: aiRow.odd_type,
        value: odd.value,
        crown_game_id: odd.game_id,
    })

    //清理频道缓存数据
    await clearChannelCache(promoted.channel)

    //修改AI推荐结果
    aiRow.value = odd.value
    await aiRow.save()

    await publish(
        CONFIG.queues['send_promoted'],
        JSON.stringify({ id: promoted.id, type: channel }),
    )
}

/**
 * AI推荐皇冠检测
 * @param content
 */
async function startAiPromotedCheck() {
    while (true) {
        const [promise] = consume('ai_promoted', (content) =>
            processAiPromotedCheck(JSON.parse(content)),
        )
        await promise
        await close()
    }
}

if (require.main === module) {
    startAiPromotedCheck()
}
