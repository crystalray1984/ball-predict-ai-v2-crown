import type { CreationOptional, InferAttributes } from 'sequelize'
import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'

/**
 * 最终推荐盘口视图
 */
@Table({ tableName: 'v_promoted_odd_mansion', timestamps: false })
export class VPromotedOddMansion extends Model<InferAttributes<VPromotedOddMansion>> {
    /**
     * 盘口id
     */
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: number

    /**
     * 比赛id
     */

    @Column(DataType.INTEGER)
    declare match_id: number

    /**
     * 是否最终推荐给用户
     */

    @Column(DataType.TINYINT)
    declare is_valid: number

    /**
     * 放弃该推荐的原因
     */
    @Column(DataType.STRING)
    declare skip: string

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
    declare result: number | null

    @Column(DataType.STRING)
    declare score: string | null

    @Column(DataType.TINYINT)
    declare score1: number | null

    @Column(DataType.TINYINT)
    declare score2: number | null

    @Column(DataType.DATE)
    declare created_at: Date

    @Column(DataType.DATE)
    declare updated_at: Date

    /**
     * 推荐水位
     */
    @Column(DataType.DECIMAL)
    declare value: string

    /**
     * 推荐产生时的正推水位
     */
    @Column(DataType.DECIMAL)
    declare value0: string

    /**
     * 推荐产生时的反推水位
     */
    @Column(DataType.DECIMAL)
    declare value1: string

    @Column(DataType.INTEGER)
    declare week_day: number

    @Column(DataType.INTEGER)
    declare week_id: number

    @Column(DataType.INTEGER)
    declare odd_id: number

    @Column(DataType.INTEGER)
    declare odd_mansion_id: number

    @Column(DataType.STRING)
    declare odd_type: OddIdentification

    @Column(DataType.DATE)
    declare match_time: Date

    @Column(DataType.INTEGER)
    declare tournament_id: number

    @Column(DataType.STRING)
    declare tournament_name: string

    /**
     * 此联赛是否开启推荐
     */
    @Column(DataType.SMALLINT)
    declare tournament_is_open: number

    /**
     * 联赛标签id
     */
    @Column(DataType.INTEGER)
    declare tournament_label_id: number

    @Column(DataType.INTEGER)
    declare team1_id: number

    @Column(DataType.STRING)
    declare team1_name: string

    @Column(DataType.INTEGER)
    declare team2_id: number

    @Column(DataType.STRING)
    declare team2_name: string
}
