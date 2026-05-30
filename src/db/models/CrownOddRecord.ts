import type {
    CreationAttributes,
    CreationOptional,
    InferAttributes,
    InferCreationAttributes,
    Transaction,
} from 'sequelize'
import {
    AutoIncrement,
    Column,
    CreatedAt,
    DataType,
    Model,
    PrimaryKey,
    Table,
} from 'sequelize-typescript'

/**
 * 皇冠盘口记录表
 */
@Table({ tableName: 'crown_odd_record', underscored: false, updatedAt: false })
export class CrownOddRecord extends Model<
    InferAttributes<CrownOddRecord>,
    InferCreationAttributes<CrownOddRecord>
> {
    /**
     * 盘口记录id
     */
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    /**
     * 皇冠比赛id
     */
    @Column(DataType.STRING)
    declare crown_match_id: string

    /**
     * 是否最新的盘口
     */
    @Column(DataType.SMALLINT)
    declare is_last: CreationOptional<0 | 1>

    /**
     * 盘口类型
     */
    @Column(DataType.STRING)
    declare show_type: 'early' | 'today' | 'live'

    /**
     * 盘口数据
     */
    @Column(DataType.JSONB)
    declare odd_data: Crown.OddInfo[]

    /**
     * 数据创建时间
     */
    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    /**
     * 插入最新的盘口数据
     */
    static async insert(data: CreationAttributes<CrownOddRecord>, transaction?: Transaction) {
        const run = async (transaction: Transaction) => {
            //标记旧盘口未非最新
            await CrownOddRecord.update(
                { is_last: 0 },
                {
                    where: {
                        crown_match_id: data.crown_match_id,
                        show_type: data.show_type,
                        is_last: 1,
                    },
                    transaction,
                },
            )
            //插入新盘口
            await CrownOddRecord.create(
                {
                    ...data,
                    is_last: 1,
                },
                { transaction },
            )
        }

        if (transaction) {
            await run(transaction)
        } else {
            await CrownOddRecord.sequelize!.transaction(run)
        }
    }
}
