import Decimal from 'decimal.js'
import { clearChannelCache, getOddIdentification } from './common/helpers'
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

    //修改AI推荐结果
    aiRow.crown_info = data.odds
    await aiRow.save()

    let channel: string
    let type: OddType
    let condition = '0'
    let value = '0'

    //根据不同的推送盘口进行计算
    if (aiRow.odd_type === 'ah') {
        //让球盘，直接推
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

        channel = `ai_${aiRow.odd_type}`
        type = aiRow.type
        condition = aiRow.condition.toString()
        value = odd.value
    } else if (aiRow.odd_type === 'sum') {
        //大小球盘，先寻找主盘
        const odds = findMatchedOdd(
            {
                variety: 'goal',
                period: aiRow.period,
                type: aiRow.type,
                condition: aiRow.condition.toString(),
            },
            data.odds,
        )

        if (odds.length === 0) return

        //先看主盘
        const mainOdd = odds[0]
        if (!Decimal(mainOdd.condition).eq(aiRow.condition)) {
            //推送的盘不是主盘，那么判断主盘比推送盘更简单还是更难
            if (aiRow.type === 'over') {
                //大球，要求主盘比推送盘小
                if (!Decimal(mainOdd.condition).lte(aiRow.condition)) {
                    //不满足条件就出去
                    return
                }
            } else if (aiRow.type === 'under') {
                //小球，要求主盘比推送盘大
                if (!Decimal(mainOdd.condition).gte(aiRow.condition)) {
                    //不满足条件就出去
                    return
                }
            } else {
                return
            }
        }

        //放入推荐
        channel = `ai_${aiRow.odd_type}`
        type = aiRow.type
        condition = aiRow.condition.toString()
        value = mainOdd.value
    } else if (aiRow.odd_type === 'win') {
        //推送的事独赢盘
        //先找让球盘的主盘
        const odds = findMatchedOdd(
            {
                variety: 'goal',
                period: aiRow.period,
                type: 'ah1',
                condition: aiRow.condition.toString(),
            },
            data.odds,
        )
        if (odds.length === 0) return

        const mainOdd = odds[0]

        //然后进行判断
        if (aiRow.type === 'draw') {
            //如果推的是平局
            if (Decimal(mainOdd.condition).eq(0)) {
                //如果主盘是0球盘，那么不推，直接出去了
                return
            } else if (Decimal(mainOdd.condition).gt(0)) {
                //主盘是主受让，那就推主
                channel = `ai_ah`
                type = 'ah1'
                condition = mainOdd.condition
                value = mainOdd.value
            } else {
                //主盘是客受让，那就推客
                channel = `ai_ah`
                type = 'ah2'
                condition = mainOdd.condition
                value = mainOdd.value_reverse
            }
        } else {
            //不是推平局的盘，就要看主盘的让球数，让球数大于1的不推
            if (Decimal(mainOdd.condition).abs().gt(1)) {
                return
            }

            //让球数不大于1，那么按推送的方向去推
            channel = `ai_ah`
            if (aiRow.type === 'win1') {
                //推主胜
                type = 'ah1'
                condition = mainOdd.condition
                value = mainOdd.value
            } else {
                //推客胜
                type = 'ah2'
                condition = Decimal(0).sub(mainOdd.condition).toString()
                value = mainOdd.value_reverse
            }
        }
    } else {
        //其他盘口不处理
        return
    }

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
        channel,
        is_valid: 1,
        skip: '',
        week_day: 0,
        week_id: 0,
        variety: 'goal',
        period: aiRow.period,
        type,
        condition,
        odd_type: getOddIdentification(type),
        value,
    })

    //清理频道缓存数据
    await clearChannelCache(promoted.channel)

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
        const [promise] = consume('ai_promoted', (content) => {
            console.log(content)
            return processAiPromotedCheck(JSON.parse(content))
        })
        await promise
        await close()
    }
}

if (require.main === module) {
    startAiPromotedCheck()
}
