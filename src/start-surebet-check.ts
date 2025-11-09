import { isEmpty } from '@/common/helpers'
import { close, consume, publish } from '@/common/rabbitmq'
import { Match, Odd, SurebetRecord } from '@/db'
import Decimal from 'decimal.js'
import { omit } from 'lodash'
import { getSetting } from './common/settings'
import { CONFIG } from './config'

/**
 * 解析surebet时间条件的时长
 * @param condition
 */
function parseTimeCondition(condition: string): number {
    let value = 0

    //天数
    const dayMatch = /([0-9]+)D/.exec(condition)
    if (dayMatch) {
        value += parseInt(dayMatch[1]) * 86400000
    }

    //小时
    const hourMatch = /([0-9]+)H/.exec(condition)
    if (hourMatch) {
        value += parseInt(hourMatch[1]) * 3600000
    }

    //分钟
    const minuteMatch = /([0-9]+)M/.exec(condition)
    if (minuteMatch) {
        value += parseInt(minuteMatch[1]) * 60000
    }

    return value
}

/**
 * 执行surebet数据过滤
 * @param content
 */
async function processSurebetCheck(content: string) {
    //解析来自surebet的数据列表
    let records = JSON.parse(content) as Surebet.OddsRecord[]

    //读取配置
    const settings = await getSetting(
        'surebet_max_profit',
        'surebet_min_profit',
        'surebet_start_of',
        'surebet_end_of',
        'min_surebet_value',
        'max_surebet_value',
    )

    const maxProfit = Decimal(settings.surebet_max_profit)
    const minProfit = Decimal(settings.surebet_min_profit)
    const startOf = parseTimeCondition(settings.surebet_start_of)
    const endOf = parseTimeCondition(settings.surebet_end_of)

    const nextDataList: string[] = []
    const toV3List: string[] = []

    for (const record of records) {
        //收益率筛选
        const profit = Decimal(record.profit)
        if (profit.lt(minProfit) || profit.gt(maxProfit)) continue

        //只筛选188bet的数据
        const odd = record.prongs.find((t) => t.bk === '188bet')
        if (!odd) continue

        //比赛时间筛选
        if (odd.time < Date.now() + startOf || odd.time > Date.now() + endOf) continue

        //插入surebet抓取数据
        try {
            await SurebetRecord.findOrCreate({
                where: {
                    crown_match_id: odd.preferred_nav.markers.eventId,
                    game: odd.type.game,
                    base: odd.type.base,
                    variety: odd.type.variety,
                    period: odd.type.period,
                    type: odd.type.type,
                },
                defaults: {
                    crown_match_id: odd.preferred_nav.markers.eventId,
                    match_time: new Date(odd.time),
                    game: odd.type.game,
                    base: odd.type.base,
                    variety: odd.type.variety,
                    period: odd.type.period,
                    type: odd.type.type,
                    condition: odd.type.condition ?? null,
                    value: String(odd.value),
                },
            })
        } catch (err) {
            console.error(err)
        }

        if (odd.type.game !== 'regular' || odd.type.base !== 'overall') continue

        //数据过滤，只留下需要的盘口
        let pass = false

        //全场让球
        if (
            odd.type.variety === 'goal' &&
            odd.type.period === 'regularTime' &&
            ['ah1', 'ah2'].includes(odd.type.type)
        ) {
            pass = true
        }

        //全场大小球
        if (
            odd.type.variety === 'goal' &&
            odd.type.period === 'regularTime' &&
            ['over', 'under'].includes(odd.type.type)
        ) {
            pass = true
        }

        //全场角球让球
        if (
            odd.type.variety === 'corner' &&
            odd.type.period === 'regularTime' &&
            ['ah1', 'ah2'].includes(odd.type.type)
        ) {
            pass = true
        }

        //全场角球大小球
        if (
            odd.type.variety === 'corner' &&
            odd.type.period === 'regularTime' &&
            ['over', 'under'].includes(odd.type.type)
        ) {
            pass = true
        }

        //上半场让球
        if (
            odd.type.variety === 'goal' &&
            odd.type.period === 'period1' &&
            ['ah1', 'ah2'].includes(odd.type.type)
        ) {
            pass = true
        }

        //上半场大小球
        if (
            odd.type.variety === 'goal' &&
            odd.type.period === 'period1' &&
            ['over', 'under'].includes(odd.type.type)
        ) {
            pass = true
        }

        //上半场角球让球
        if (
            odd.type.variety === 'corner' &&
            odd.type.period === 'period1' &&
            ['ah1', 'ah2'].includes(odd.type.type)
        ) {
            pass = true
        }

        //上半场角球大小球
        if (
            odd.type.variety === 'corner' &&
            odd.type.period === 'period1' &&
            ['over', 'under'].includes(odd.type.type)
        ) {
            pass = true
        }

        //赔率大于指定的值
        const surebet_value = Decimal(odd.value)

        if (!isEmpty(settings.min_surebet_value)) {
            if (!surebet_value.gte(settings.min_surebet_value)) {
                pass = false
            }
        }

        if (!isEmpty(settings.max_surebet_value)) {
            if (!surebet_value.lte(settings.max_surebet_value)) {
                pass = false
            }
        }

        if (!pass) continue

        //构建需要抛到后续队列的参数
        const output: Surebet.Output = {
            crown_match_id: odd.preferred_nav.markers.eventId,
            match_time: odd.time,
            type: omit(odd.type, 'game', 'base'),
            surebet_value: String(odd.value),
        }

        //满足v2条件的全场盘口，抛到v3队列进行比对
        if (output.type.period === 'regularTime' && output.type.variety === 'goal') {
            toV3List.push(JSON.stringify(output))
        }

        //确定盘口是否存在
        const exists = await Odd.findOne({
            where: {
                crown_match_id: output.crown_match_id,
                variety: output.type.variety,
                period: output.type.period,
                condition: output.type.condition,
                type: output.type.type,
            },
        })

        if (exists) {
            //已经有这个盘口了，那么更新一下surebet的推送时间
            exists.surebet_updated_at = new Date()
            await exists.save()
            if (exists.status !== '') {
                //状态不为空表示已经经过处理了，那么跳过
                continue
            }
        }

        //判断比赛，如果比赛存在且状态为已结算那么也跳过
        const match = await Match.findOne({
            where: {
                crown_match_id: output.crown_match_id,
            },
            attributes: ['id', 'status'],
        })
        if (match && match.status !== '') {
            continue
        }

        //把盘口抛到消息队列进行第一次比对
        nextDataList.push(
            JSON.stringify({
                crown_match_id: output.crown_match_id,
                next: CONFIG.queues['ready_check_after'],
                extra: output,
            }),
        )
        console.log('抛到消息队列进行第一次比对', output.crown_match_id)
    }

    if (nextDataList.length > 0) {
        await publish('crown_odd', nextDataList)
    }
}

/**
 * 开启surebet检查
 */
export async function startSurebetCheck() {
    while (true) {
        const [promise] = consume(CONFIG.queues['surebet_check'], processSurebetCheck)
        await promise
        await close()
    }
}

if (require.main === module) {
    startSurebetCheck()
}
