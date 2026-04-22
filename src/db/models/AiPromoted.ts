import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import {
    AllowNull,
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
 * AI推荐记录表
 */
@Table({ tableName: 'ai_promoted', underscored: false })
export class AiPromoted extends Model<
    InferAttributes<AiPromoted>,
    InferCreationAttributes<AiPromoted>
> {
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
     * 时段
     */
    @Column(DataType.STRING)
    declare period: Period

    /**
     * 盘口类型
     */
    @Column(DataType.STRING)
    declare odd_type: OddIdentification

    /**
     * 类型
     */
    @Column(DataType.STRING)
    declare type: OddType

    /**
     * 盘口条件
     */
    @Column(DataType.DECIMAL)
    declare condition: NumberVal

    /**
     * 水位
     */
    @Column(DataType.DECIMAL)
    declare value: CreationOptional<NumberVal | null>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>

    @AllowNull(true)
    @Column(DataType.JSON)
    declare crown_info: CreationOptional<any>
}
