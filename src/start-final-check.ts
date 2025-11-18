import { getSetting } from '@/common/settings'
import { db, Match } from '@/db'
import { Op, QueryTypes } from 'sequelize'

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
 * 处理赛事的最终结算
 */
async function processFinalMatches() {
    //读取开赛时间配置
    const final_check_time = await (async () => {
        const final_check_time = await getSetting('final_check_time')
        return typeof final_check_time === 'number' ? final_check_time : 20
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
            match_time <= ?
            AND status = ?
            AND id IN (SELECT match_id FROM odd WHERE status = ?)
        `,
            values: [
                new Date(Date.now() + final_check_time * 60000), //只抓取将在指定时间内开赛的比赛
                '', //只选择还未结算的比赛
                'ready', //有准备中的盘口的比赛
            ],
        },
        {
            type: QueryTypes.SELECT,
        },
    )

    if (matches.length === 0) return

    //把这些比赛都标记为已结算
    await Match.update(
        { status: 'final' },
        {
            where: {
                id: {
                    [Op.in]: matches.map((t) => t.id),
                },
            },
        },
    )

    for (const match of matches) {
        console.log(
            '最终结算判断',
            `match_id=${match.id}`,
            `crown_match_id=${match.crown_match_id}`,
        )
    }
}

/**
 * 进行V3的最终判断
 * @param match_id
 * @param crown_match_id
 */
async function processFinalCheck(match_id: number, crown_match_id: string) {}
