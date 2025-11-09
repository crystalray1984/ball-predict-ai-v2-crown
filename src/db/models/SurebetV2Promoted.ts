import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import {
    AutoIncrement,
    Column,
    CreatedAt,
    DataType,
    Model,
    PrimaryKey,
    Table,
    UpdatedAt,
} from 'sequelize-typescript'

/**
 * 最终推荐盘口表
 */
@Table({ tableName: 'surebet_v2_promoted' })
export class SurebetV2Promoted extends Model<
    InferAttributes<SurebetV2Promoted>,
    InferCreationAttributes<SurebetV2Promoted>
> {
    /**
     * 盘口id
     */
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    /**
     * 比赛id
     */
    @Column(DataType.INTEGER)
    declare match_id: number

    /**
     * 是否最终推荐给用户
     */

    @Column(DataType.TINYINT)
    declare is_valid: CreationOptional<number>

    /**
     * 放弃该推荐的原因
     */
    @Column(DataType.STRING)
    declare skip: CreationOptional<string>

    /**
     * 投注目标
     */

    @Column(DataType.STRING)
    declare variety: Variety

    /**
     * 比赛时段
     */

    @Column(DataType.STRING)
    declare period: Period

    /**
     * 投注方向
     */

    @Column(DataType.STRING)
    declare type: OddType

    /**
     * 盘口条件
     */

    @Column(DataType.DECIMAL(5, 2))
    declare condition: string

    /**
     * 是否反推
     */
    @Column(DataType.INTEGER)
    declare back: number

    @Column(DataType.TINYINT)
    declare result: CreationOptional<number | null>

    @Column(DataType.STRING)
    declare score: CreationOptional<string | null>

    @Column(DataType.TINYINT)
    declare score1: CreationOptional<number | null>

    @Column(DataType.TINYINT)
    declare score2: CreationOptional<number | null>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>

    @Column(DataType.DECIMAL)
    declare value: CreationOptional<string>

    @Column(DataType.INTEGER)
    declare week_day: CreationOptional<number>

    @Column(DataType.INTEGER)
    declare week_id: CreationOptional<number>

    @Column(DataType.STRING)
    declare odd_type: 'ah' | 'sum'
}
