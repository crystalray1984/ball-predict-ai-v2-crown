import { CrownMainOdd, db } from '@/db'
import Decimal from 'decimal.js'
import { createHash } from 'node:crypto'
import { CreationAttributes } from 'sequelize'

function md5(input: string) {
    return createHash('md5').update(input).digest('hex').toLowerCase()
}

/**
 * 解析皇冠采集到的盘口，写入主盘表，供bmiss投注使用
 */
export async function parseMainOddForBmiss(
    all: CrownRobot.Output<{
        match_id: number
    }>,
) {
    const odds = all.data!.odds
    const match_id = all.extra!.match_id

    /**
     * 保存盘口数据的统一方法
     * @param odd
     */
    const save = async (
        odd: Omit<CreationAttributes<CrownMainOdd>, 'match_id' | 'is_active' | 'hash'>,
    ) => {
        //首先计算盘口的hash值
        const hashBase: string[] = [
            Decimal(odd.condition).toFixed(2),
            Decimal(odd.value1).toFixed(4),
            Decimal(odd.value2).toFixed(4),
        ]
        if (odd.value0) {
            hashBase.push(Decimal(odd.value0).toFixed(4))
        }

        const hash = md5(hashBase.join('|'))

        //然后开启事务
        await db.transaction(async (transaction) => {
            //去寻找这个比赛的当前激活的此类盘口
            const exists = await CrownMainOdd.findOne({
                where: {
                    match_id,
                    base: odd.base,
                    is_active: 1,
                },
                attributes: ['id', 'hash', 'is_active'],
                transaction,
                lock: transaction.LOCK.UPDATE,
            })
            if (exists) {
                //有存在的当前盘口，检查hash是否相同
                if (exists.hash === hash) {
                    //相同则不处理
                    return
                }

                //把之前的数据改为非激活
                exists.is_active = 0
                await exists.save({ transaction })
            }

            //写入新数据
            await CrownMainOdd.create(
                {
                    ...odd,
                    match_id,
                    is_active: 1,
                    hash,
                },
                {
                    transaction,
                    returning: false,
                },
            )
        })
    }

    //让球主盘
    const ah = odds.find((t) => t.variety === 'goal' && t.type === 'r')
    if (ah) {
        await save({
            base: 'ah',
            condition: ah.condition,
            value1: ah.value_h,
            value2: ah.value_c,
        })
    }

    //胜平负主盘
    const win = odds.find((t) => t.variety === 'goal' && t.type === 'm')
    if (win) {
        //写入胜平负盘口
        await save({
            base: 'win',
            condition: '0',
            value1: win.value_h,
            value2: win.value_c,
            value0: win.value_n!,
        })
    }

    //大小球盘口
    const sum = odds.find((t) => t.variety === 'goal' && t.type === 'ou')
    if (sum) {
        //写入大小球盘口
        await save({
            base: 'sum',
            condition: sum.condition,
            value1: sum.value_h,
            value2: sum.value_c,
        })
    }
}
