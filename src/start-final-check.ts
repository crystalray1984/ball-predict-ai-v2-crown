import {
    findRuleWithValue,
    getPromotedOddInfo,
    getSameOddTypes,
    isNullOrUndefined,
    runLoop,
} from '@/common/helpers'
import { publish } from '@/common/rabbitmq'
import { getSetting } from '@/common/settings'
import { db, ManualPromoteOdd, Match, Odd, PromotedOdd } from '@/db'
import Decimal from 'decimal.js'
import { Op, QueryTypes } from 'sequelize'
import { CONFIG } from './config'

/**
 * 将推荐数据发送到队列中推荐给用户
 */
function sendPromotedQueue(id: number) {
    return publish(CONFIG.queues['send_promoted'], JSON.stringify({ id }))
}

/**
 * 寻找即将开赛的比赛，把数据抛入到皇冠的二次处理队列中
 */
async function processNearlyMatches() {
    //读取开赛时间配置
    const final_check_time = await (async () => {
        const final_check_time = await getSetting('final_check_time')
        return typeof final_check_time === 'number' ? final_check_time : 5
    })()

    //先查询需要处理的比赛
    const matches = await db.query<{
        id: number
        crown_match_id: string
    }>(
        {
            query: `
        SELECT
            id,
            crown_match_id
        FROM
            match
        WHERE
            match_time BETWEEN ? AND ?
            AND status = ?
            AND id IN (SELECT match_id FROM odd WHERE status = ?)
        `,
            values: [
                new Date(Date.now() + 15000), //15秒内
                new Date(Date.now() + final_check_time * 60000), //只抓取5分内开赛的比赛
                '', //只选择还未结算的比赛
                'ready', //有准备中的盘口的比赛
            ],
        },
        {
            type: QueryTypes.SELECT,
        },
    )

    if (matches.length === 0) return

    //把比赛标记为已完成
    await Match.update(
        {
            status: 'final',
        },
        {
            where: {
                id: {
                    [Op.in]: matches.map((t) => t.id),
                },
            },
        },
    )
}

/**
 * 处理手动推荐的盘口
 */
async function processManualPromote(final_check_time: number) {
    //读取符合条件的手动推荐的盘口
    const odds = await db.query<
        {
            id: number
            match_id: number
            condition2: string | null
            type2: OddInfo['type'] | null
        } & OddInfo
    >(
        {
            query: `
            SELECT
                "manual_promote_odd".*
            FROM
                "manual_promote_odd"
            INNER JOIN
                "manual_promote_record" ON "manual_promote_odd"."record_id" = "manual_promote_record"."id"
            INNER JOIN
                "match" ON "match"."id" = "manual_promote_odd"."match_id"
            WHERE
                "manual_promote_odd"."deleted_at" IS NULL
                AND "manual_promote_record"."deleted_at" IS NULL
                AND "manual_promote_odd"."promoted_odd_id" = 0
                AND "match"."match_time" BETWEEN ? AND ?`,
            values: [
                new Date(Date.now() + final_check_time * 60000),
                new Date(Date.now() + (final_check_time + 2) * 60000),
            ],
        },
        {
            type: QueryTypes.SELECT,
        },
    )

    if (odds.length === 0) {
        return
    }

    //插入盘口
    for (const odd of odds) {
        await db.transaction(async (transaction) => {
            const promoted = await PromotedOdd.create(
                {
                    match_id: odd.match_id,
                    odd_id: 0,
                    manual_promote_odd_id: odd.id,
                    is_valid: 1,
                    skip: '',
                    variety: odd.variety,
                    period: odd.period,
                    condition: odd.condition,
                    type: odd.type,
                    back: 0,
                    type2: odd.type2,
                    condition2: odd.condition2,
                },
                {
                    transaction,
                    returning: ['id'],
                },
            )

            await ManualPromoteOdd.update(
                {
                    promoted_odd_id: promoted.id,
                },
                {
                    where: {
                        id: odd.id,
                    },
                    transaction,
                    returning: false,
                },
            )

            sendPromotedQueue(promoted.id)
        })
    }
}

/**
 * 处理直接推荐的盘口
 * @param final_check_time
 */
async function processDirectOdd(final_check_time: number) {
    //读取直推配置
    let direct_config = await getSetting<DirectConfig[]>('direct_config')
    if (
        isNullOrUndefined(direct_config) ||
        !Array.isArray(direct_config) ||
        direct_config.length === 0
    ) {
        return
    }

    //直通配置只处理勾选了通道1的
    direct_config = direct_config.filter((config) => {
        if (!Array.isArray(config.publish_channels)) return false
        return config.publish_channels.includes('channel1')
    })
    if (direct_config.length === 0) {
        return
    }

    //查询需要处理的盘口列表，按surebet推送时间倒序排列，先处理新的
    const odds = await db.query(
        {
            query: `
            SELECT
                *
            FROM
                "odd"
            WHERE
                match_id IN (
                SELECT
                    id
                FROM
                    "v_match"
                WHERE
                    match_time BETWEEN ? AND ?
                    AND tournament_is_open = ?
                )
                AND is_open = ?
            ORDER BY
                surebet_updated_at DESC
            `,
            values: [
                new Date(Date.now() + final_check_time * 60000),
                new Date(Date.now() + (final_check_time + 2) * 60000),
                1,
                1,
            ],
        },
        {
            type: QueryTypes.SELECT,
            model: Odd,
        },
    )

    if (odds.length === 0) {
        return
    }

    //盘口处理
    for (const odd of odds) {
        //在寻找规则之前，对盘口是否已经通过一次判断进行筛选
        const filtered_config =
            odd.status === ''
                ? direct_config.filter((config) => !config.first_check)
                : direct_config

        //先对盘口进行规则判断
        const rule = findRuleWithValue(filtered_config, {
            variety: odd.variety,
            period: odd.period,
            type: odd.type,
            condition: odd.condition,
            value: odd.surebet_value,
        })
        if (!rule) {
            //不满足规则
            continue
        }

        //再看看是否已经存在同类的手动推荐
        const promoted = await PromotedOdd.findOne({
            where: {
                match_id: odd.match_id,
                variety: odd.variety,
                period: odd.period,
                type: {
                    [Op.in]: getSameOddTypes(odd.type),
                },
            },
            attributes: ['id'],
        })

        if (promoted) {
            //已经有手动推荐了，那就不推了
            continue
        }

        //确定推荐的方向和盘口
        let { condition, type } = getPromotedOddInfo(odd, rule.back)

        //确定变盘
        condition = Decimal(condition).add(rule.adjust).toString()

        //生成推荐
        try {
            await db.transaction(async (transaction) => {
                //创建推荐
                const promoted = await PromotedOdd.create(
                    {
                        match_id: odd.match_id,
                        odd_id: odd.id,
                        is_valid: 1,
                        skip: '',
                        variety: odd.variety,
                        period: odd.period,
                        condition,
                        type,
                        back: rule.back ? 1 : 0,
                        final_rule: 'direct',
                    },
                    {
                        transaction,
                        returning: ['id'],
                    },
                )

                //修改盘口的状态
                odd.status = 'promoted'
                await odd.save({
                    transaction,
                })

                sendPromotedQueue(promoted.id)
            })
        } catch (err) {
            console.error(err)
        }
    }
}

/**
 * 处理赛前的二次数据检查
 */
async function processBeforeCheck() {
    //读取开赛时间配置
    const final_check_time = await (async () => {
        const final_check_time = await getSetting('final_check_time')
        return typeof final_check_time === 'number' ? final_check_time : 5
    })()

    //处理手动推荐的盘口
    await processManualPromote(final_check_time)
    //处理直接推荐的盘口
    await processDirectOdd(final_check_time)
}

/**
 * 开始二次数据检查
 */
async function startFinalCheck() {
    return runLoop(30000, processNearlyMatches)
}

/**
 * 开始赛前的二次数据检查
 */
async function startBeforeFinalCheck() {
    return runLoop(15000, processBeforeCheck)
}

if (require.main === module) {
    startFinalCheck()
    startBeforeFinalCheck()
}
