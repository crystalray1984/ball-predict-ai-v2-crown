import { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
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
 * 滚球追踪盘口表
 */
@Table({ tableName: 'rockball_odd' })
export class RockballOdd extends Model<
    InferAttributes<RockballOdd>,
    InferCreationAttributes<RockballOdd>
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
     * 皇冠比赛id
     */
    @Column(DataType.STRING)
    declare crown_match_id: string

    /**
     * 推荐频道
     */
    @Column(DataType.STRING)
    declare channel: string

    /**
     * 投注目标
     */
    @Column(DataType.STRING)
    declare source_variety: Variety

    /**
     * 比赛时段
     */
    @Column(DataType.STRING)
    declare source_period: Period

    /**
     * 投注方向
     */
    @Column(DataType.STRING)
    declare source_type: OddType

    /**
     * 盘口条件
     */
    @Column(DataType.DECIMAL)
    declare source_condition: string

    /**
     * surebet水位
     */
    @Column(DataType.DECIMAL)
    declare source_value: string

    /**
     * 盘口状态
     */
    @Column(DataType.STRING)
    declare status: CreationOptional<string>

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
    @Column(DataType.DECIMAL)
    declare condition: string

    /**
     * 比对的条件水位
     */
    @Column(DataType.DECIMAL)
    declare value: string

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>

    @Column(DataType.INTEGER)
    declare is_open: CreationOptional<number>

    /**
     * 来源推荐通道
     */
    @Column(DataType.STRING)
    declare source_channel: string

    /**
     * 来源推荐id
     */
    @Column(DataType.INTEGER)
    declare source_id: number

    /**
     * 手动设置的投注方向
     */
    @Column(DataType.STRING)
    declare manual_type: CreationOptional<OddType>
}
