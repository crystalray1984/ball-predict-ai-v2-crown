import { Match, MatchTeamInfo, RockballOdd, VPromoted } from '@/db'
import { predictPeriod1Goals } from '@/predict'
import Decimal from 'decimal.js'
import { InferAttributes, Op } from 'sequelize'
import { isDecimal } from './helpers'
import { getSetting } from './settings'

/**
 * 通过其他推荐数据作为滚球输入的数据
 */
interface RockballInput extends Pick<
    InferAttributes<VPromoted>,
    | 'id'
    | 'channel'
    | 'match_id'
    | 'variety'
    | 'period'
    | 'type'
    | 'condition'
    | 'value'
    | 'crown_match_id'
> {}

/**
 * 根据已经推荐出来的盘口信息生成滚球盘
 */
export async function createRockballOddFromPromoted(input: RockballInput | number) {
    const config = await getSetting<RockballConfig[]>('rockball_config')
    if (!config || !Array.isArray(config) || config.length === 0) {
        return
    }

    if (typeof input === 'number') {
        const promoted = await VPromoted.findOne({
            where: {
                id: input,
            },
        })
        if (!promoted) return
        input = promoted
    }

    let matchedRule: RockballConfig | undefined = undefined

    for (const rule of config) {
        //基础盘口判定
        if (rule.variety !== input.variety) continue
        if (rule.period !== input.period) continue
        if (rule.type !== input.type) continue

        if (!isDecimal(rule.condition2)) {
            //规则盘口是个固定值
            if (!Decimal(rule.condition).eq(input.condition)) continue
        } else {
            //规则盘口是个范围
            if (
                !(
                    Decimal(input.condition).gte(rule.condition) &&
                    Decimal(input.condition).lte(rule.condition2)
                )
            ) {
                continue
            }
        }

        matchedRule = rule
        break
    }

    if (!matchedRule) return

    //在生成盘口之前，先判断之前有没有其他更小的盘口创建的待抓取盘口
    const smaller = await RockballOdd.findOne({
        where: {
            match_id: input.match_id,
            source_condition: {
                [Op.lte]: input.condition,
            },
            channel: 'rockball',
        },
        attributes: ['id'],
    })

    //如果已经有更小的盘口创建的就出去了
    if (smaller) return

    //删除更大的来盘创建的盘口
    await RockballOdd.destroy({
        where: {
            match_id: input.match_id,
            source_condition: {
                [Op.gt]: input.condition,
            },
        },
    })

    //开始生成盘口
    for (const oddRule of matchedRule.odds) {
        //尝试寻找相同的盘口
        const odd = await RockballOdd.findOne({
            where: {
                match_id: input.match_id,
                variety: oddRule.variety,
                period: oddRule.period,
                type: oddRule.type,
                condition: oddRule.condition,
                channel: 'rockball',
            },
        })
        if (odd) {
            //如果盘口已存在，判断一下水位是否更低
            if (Decimal(oddRule.value).lt(odd.value)) {
                //水位更低就按新的水位写入
                odd.value = oddRule.value
                odd.source_variety = input.variety
                odd.source_period = input.period
                odd.source_type = input.type
                odd.source_condition = input.condition
                odd.source_value = input.value ?? '0'
                await odd.save()
            }
        } else {
            //盘口不存在就创建盘口
            await RockballOdd.create({
                match_id: input.match_id,
                crown_match_id: input.crown_match_id,
                source_variety: input.variety,
                source_period: input.period,
                source_condition: input.condition,
                source_type: input.type,
                source_value: input.value ?? '0',
                variety: oddRule.variety,
                period: oddRule.period,
                type: oddRule.type,
                condition: oddRule.condition,
                value: oddRule.value,
                is_open: oddRule.disabled ? 0 : 1,
                source_channel: input.channel,
                source_id: input.id,
                channel: 'rockball',
            })
        }
    }
}

/**
 * 根据已经推荐出来的推荐（模型2）生成滚球3的准备数据
 * @param id
 */
export async function createRockball3Odd(input: RockballInput | number) {
    if (typeof input === 'number') {
        const promoted = await VPromoted.findOne({
            where: {
                id: input,
            },
        })
        if (!promoted) return
        input = promoted
    }

    //构建滚球准备盘口
    const type: OddType = 'over'
    //降0.25盘
    const condition = Decimal(input.condition).sub('0.25').toString()
    //水位条件固定为2.15
    const value = '2.15'

    //查询有没有存在的盘口
    const exists = await RockballOdd.findOne({
        where: {
            match_id: input.match_id,
            channel: 'rockball3',
        },
        attributes: ['id'],
    })

    if (exists) return

    //盘口不存在就创建盘口
    await RockballOdd.create({
        match_id: input.match_id,
        crown_match_id: input.crown_match_id,
        source_variety: input.variety,
        source_period: input.period,
        source_condition: input.condition,
        source_type: input.type,
        source_value: input.value ?? '0',
        variety: 'goal',
        period: 'regularTime',
        type,
        condition,
        value,
        is_open: 1,
        source_channel: input.channel,
        source_id: input.id,
        channel: 'rockball3',
    })
}

/**
 * 计算上半场进球系数
 */
export function calculateCoefficient(team1_info: TeamInfo, team2_info: TeamInfo) {
    // 主队
    const hGames = team1_info.matches + team1_info.matches_30day
    let hAvgScored = Decimal(0),
        hAvgConceded = Decimal(0)
    if (hGames > 0) {
        const hScored = team1_info.goals_scored_period1 + team1_info.goals_scored_period1_30day
        const hConceded = team1_info.goals_allowed_period1 + team1_info.goals_allowed_period1_30day
        hAvgScored = Decimal(hScored).div(hGames)
        hAvgConceded = Decimal(hConceded).div(hGames)
    }

    // 客队
    const aGames = team2_info.matches + team2_info.matches_30day
    let aAvgScored = Decimal(0),
        aAvgConceded = Decimal(0)
    if (aGames > 0) {
        const aScored = team2_info.goals_scored_period1 + team2_info.goals_scored_period1_30day
        const aConceded = team2_info.goals_allowed_period1 + team2_info.goals_allowed_period1_30day
        aAvgScored = Decimal(aScored).div(aGames)
        aAvgConceded = Decimal(aConceded).div(aGames)
    }

    // 综合系数：进攻权重1.2，防守漏洞权重0.8
    const atk = hAvgScored.add(aAvgScored).mul('1.2')
    const def = hAvgConceded.add(aAvgConceded).mul('0.8')
    return atk.add(def)
}

/**
 * 基于当前比赛判断是否要进入滚球5
 * @param match_id 比赛id
 */
export async function createRockball5(match: Pick<Match, 'id' | 'crown_match_id'>) {
    //检查比赛的对阵双方信息
    const matchInfo = await MatchTeamInfo.findByPk(match.id)

    //没有数据的不要
    if (!matchInfo || !matchInfo.team1_info || !matchInfo.team2_info) return

    //抛入模型进行计算
    const [result] = predictPeriod1Goals(matchInfo as any)
    if (!result) return

    //查询有没有存在的盘口
    const exists = await RockballOdd.findOne({
        where: {
            match_id: match.id,
            channel: 'rockball5',
        },
        attributes: ['id'],
    })

    if (exists) return

    //盘口不存在就创建盘口
    await RockballOdd.create({
        match_id: match.id,
        crown_match_id: match.crown_match_id,
        source_variety: 'goal',
        source_period: 'period1',
        source_condition: '0.5',
        source_type: 'over',
        source_value: '0',
        variety: 'goal',
        period: 'period1',
        type: 'over',
        condition: '0.5',
        value: '1.88',
        is_open: 1,
        source_channel: '',
        source_id: 0,
        channel: 'rockball5',
    })
}
