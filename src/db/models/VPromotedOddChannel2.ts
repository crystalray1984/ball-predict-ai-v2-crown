import type { InferAttributes } from 'sequelize'
import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'

/**
 * 最终推荐盘口视图
 */
@Table({ tableName: 'v_promoted_odd_promoted2', timestamps: false })
export class VPromotedOddChannel2 extends Model<InferAttributes<VPromotedOddChannel2>> {
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
     * 原始盘口id
     */

    @Column(DataType.INTEGER)
    declare odd_id: number

    /**
     * 手动推荐盘口id
     */

    @Column(DataType.INTEGER)
    declare manual_promote_odd_id: number

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
     * 第二投注方向
     */
    @Column(DataType.STRING)
    declare type2: OddType | null

    /**
     * 盘口条件
     */

    @Column(DataType.DECIMAL(5, 2))
    declare condition: string

    /**
     * 第二盘口条件
     */
    @Column(DataType.DECIMAL(5, 2))
    declare condition2: string | null

    /**
     * 是否反推
     */
    @Column(DataType.INTEGER)
    declare back: number

    /**
     * 正反推规则
     */
    @Column(DataType.STRING)
    declare final_rule: string

    @Column(DataType.TINYINT)
    declare result: number | null

    @Column(DataType.TINYINT)
    declare result1: number | null

    @Column(DataType.TINYINT)
    declare result2: number | null

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

    @Column(DataType.DATE)
    declare match_time: Date

    @Column(DataType.STRING)
    declare tournament_name: string

    /**
     * 此联赛是否开启推荐
     */
    @Column(DataType.SMALLINT)
    declare tournament_is_open: number

    @Column(DataType.STRING)
    declare team1_name: string

    @Column(DataType.STRING)
    declare team2_name: string
}
