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
 * 盘口表
 */
@Table({ tableName: 'odd' })
export class Odd extends Model<InferAttributes<Odd>, InferCreationAttributes<Odd>> {
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
     * 盘口状态
     */
    @Column(DataType.STRING)
    declare status: CreationOptional<OddStatus>

    /**
     * surebet水位
     */
    @Column(DataType.DECIMAL)
    declare surebet_value: string

    /**
     * 第一次比对时的皇冠水位
     */
    @Column(DataType.DECIMAL)
    declare crown_value: string | null

    /**
     * 第二次比对时的皇冠水位
     */
    @Column(DataType.DECIMAL)
    declare crown_value2: CreationOptional<string | null>

    /**
     * 第二次比对时的皇冠盘口条件
     */
    @Column(DataType.DECIMAL)
    declare crown_condition2: CreationOptional<string | null>

    /**
     * 首次对比完成时间
     */
    @Column(DataType.DATE)
    declare ready_at: CreationOptional<Date | null>

    /**
     * 二次对比完成时间
     */
    @Column(DataType.DATE)
    declare final_at: CreationOptional<Date | null>

    /**
     * 二次对比规则时间
     */
    @Column(DataType.STRING)
    declare final_rule: CreationOptional<PromotedFinalRule>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>

    @Column(DataType.DATE)
    declare surebet_updated_at: CreationOptional<Date>
}
