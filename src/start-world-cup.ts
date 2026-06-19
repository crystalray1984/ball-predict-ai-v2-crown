import Decimal from 'decimal.js'
import { Attributes, CreationAttributes, Op, QueryTypes } from 'sequelize'
import { CROWN_ODD_QUEUE } from './common/constants'
import { getOddResult, md5, runLoop } from './common/helpers'
import { consume, publish } from './common/rabbitmq'
import { CrownOddRecord, db, FBet, FMatch, Match } from './db'

/**
 * 更新世界杯比赛的盘口数据
 */
async function startWorldCup() {
    //找到需要采集的热门比赛盘口
    const matches = await db.query<{
        id: number
        crown_match_id: string
    }>(
        `
            SELECT
                a.id,
                a.crown_match_id
            FROM
            (
                SELECT
                    "match".id,
                    "match".crown_match_id,
                    f_match.updated_at AS updated_at
                FROM
                    "match"
                LEFT JOIN f_match
                    ON f_match.match_id = "match".id
                WHERE
                    "match".match_time > CURRENT_TIMESTAMP + interval '5 minutes'
                    AND "match".match_time < CURRENT_TIMESTAMP + interval '18 hours'
                    AND "match".tournament_id IN (1022)
            ) AS a
            WHERE
                a.updated_at IS NULL OR a.updated_at < CURRENT_TIMESTAMP - interval '5 minutes'
            `,
        {
            type: QueryTypes.SELECT,
            raw: true,
        },
    )

    console.log('需要采盘口的世界杯比赛', JSON.stringify(matches.map((t) => t.crown_match_id)))
    if (matches.length === 0) return

    const queueData = matches.map((row) =>
        JSON.stringify({
            crown_match_id: row.crown_match_id,
            next: 'world-cup-2026',
            extra: row.id,
        }),
    )

    await publish(CROWN_ODD_QUEUE, queueData)
}

async function updateMatchOdd(all: CrownRobot.Output<number>) {
    if (!all.extra || !all.data) return

    const match_id = all.extra
    const odds = all.data.odds

    //先检查比赛是否已开始
    const match = await Match.findOne({
        where: {
            id: match_id,
        },
        attributes: ['id', 'match_time'],
    })
    if (!match) return
    if (match.match_time.valueOf() <= Date.now()) {
        return
    }

    const ah = odds.find((t) => t.type === 'r' && t.variety === 'goal')
    const win = odds.find((t) => t.type === 'm' && t.variety === 'goal')

    //再检查比赛是否已经添加到可投注比赛中
    const target = await FMatch.findOne({
        where: {
            match_id,
        },
    })

    if (target) {
        //已经有数据了就更新
        const fields: Partial<Attributes<FMatch>> = {
            updated_at: new Date(),
        }

        //判断让球盘是否需要更新
        if (ah) {
            const ah_condition = Decimal(ah.condition).toFixed(2)
            const ah1_value = Decimal(ah.value_h).mul('0.95').toFixed(2)
            const ah2_value = Decimal(ah.value_c).mul('0.95').toFixed(2)
            const ah_hash = md5(`${ah_condition}:${ah1_value}:${ah2_value}`)
            if (ah_hash !== target.ah_hash) {
                fields.ah_hash = ah_hash
                fields.ah_condition = ah_condition
                fields.ah1_value = ah1_value
                fields.ah2_value = ah2_value
            }
        }
        //判断胜平负是否需要更新
        if (win && target.win_open) {
            const win1_value = Decimal(win.value_h).mul('0.95').toFixed(2)
            const win2_value = Decimal(win.value_c).mul('0.95').toFixed(2)
            const draw_value = Decimal(win.value_n!).mul('0.95').toFixed(2)
            const win_hash = md5(`${win1_value}:${win2_value}:${draw_value}`)
            if (win_hash !== target.win_hash) {
                fields.win_hash = win_hash
                fields.win1_value = win1_value
                fields.win2_value = win2_value
                fields.draw_value = draw_value
            }
        }

        await FMatch.update(fields, { where: { match_id } })
    } else {
        //没有数据
        if (!ah) return

        //查询最早的盘的让球数
        let win_open = 0
        const firstOdd = await CrownOddRecord.findOne({
            where: {
                crown_match_id: all.crown_match_id,
            },
            order: ['id'],
        })
        if (firstOdd) {
            //如果让球数在1球以内就开胜平负
            const exists = firstOdd.odd_data.find((t) => t.type === 'r' && t.variety === 'goal')
            if (exists && Decimal(exists.condition).abs().lt(1)) {
                win_open = 1
            }
        }

        const ah_condition = Decimal(ah.condition).toFixed(2)
        const ah1_value = Decimal(ah.value_h).mul('0.95').toFixed(2)
        const ah2_value = Decimal(ah.value_c).mul('0.95').toFixed(2)
        const ah_hash = md5(`${ah_condition}:${ah1_value}:${ah2_value}`)

        const fields: CreationAttributes<FMatch> = {
            match_id,
            ah_condition,
            ah1_value,
            ah2_value,
            ah_hash,
            win_open,
        }

        if (win_open && win) {
            const win1_value = Decimal(win.value_h).mul('0.95').toFixed(2)
            const win2_value = Decimal(win.value_c).mul('0.95').toFixed(2)
            const draw_value = Decimal(win.value_n!).mul('0.95').toFixed(2)
            const win_hash = md5(`${win1_value}:${win2_value}:${draw_value}`)
            fields.win_hash = win_hash
            fields.win1_value = win1_value
            fields.win2_value = win2_value
            fields.draw_value = draw_value
        } else {
            fields.win_open = 0
        }

        await FMatch.create(fields)
    }
}

/**
 * 拿到皇冠数据之后的世界杯检查进程
 */
async function startCheckProcessor() {
    const [promise] = consume('world-cup-2026', async (content) => {
        await updateMatchOdd(JSON.parse(content))
    })
    await promise
}

/**
 * 投注结算
 */
async function calcBet() {
    const matches = await db.query<{
        id: number
        score1: number
        score2: number
    }>(
        `
    SELECT
      b.id,
      b.score1,
      b.score2
    FROM
    (
    SELECT
      match_id
    FROM
      f_bet
    WHERE
      result IS NULL
    GROUP BY
      match_id
    ) AS a
    INNER JOIN
      "match" AS b ON b.id = a.match_id
    WHERE
      b.has_score = 1
    `,
        {
            type: QueryTypes.SELECT,
        },
    )

    console.log(`需要结算的世界杯比赛`, matches.length)
    if (matches.length === 0) return

    const bets = await FBet.findAll({
        where: {
            match_id: {
                [Op.in]: matches.map((t) => t.id),
            },
            result: null,
        },
    })

    console.log(`需要结算的世界杯投注`, bets.length)

    for (const bet of bets) {
        const match = matches.find((t) => t.id === bet.match_id)
        if (!match) continue

        //计算结果
        const result = getOddResult(
            {
                period: 'regularTime',
                variety: 'goal',
                type: bet.type,
                condition: bet.condition,
                value: bet.value,
            },
            {
                score1: match.score1,
                score2: match.score2,
            } as any,
        )
        if (!result) continue

        bet.result = result.result
        bet.result_profit = Decimal(bet.amount)
            .mul(result.result_profit!)
            .toDecimalPlaces(1)
            .toString()
        await bet.save()
    }
}

if (require.main === module) {
    runLoop(180000, startWorldCup)
    runLoop(60000, calcBet)
    startCheckProcessor()
}
