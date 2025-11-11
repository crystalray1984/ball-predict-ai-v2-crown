import type { InferAttributes } from 'sequelize'
import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'

/**
 * 最终推荐盘口视图
 */
@Table({ tableName: 'v_label_promoted', timestamps: false })
export class VLabelPromoted extends Model<InferAttributes<VLabelPromoted>> {
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

    @Column(DataType.DECIMAL)
    declare value: string

    @Column(DataType.INTEGER)
    declare week_day: number

    @Column(DataType.INTEGER)
    declare week_id: number

    @Column(DataType.DATE)
    declare match_time: Date

    @Column(DataType.STRING)
    declare tournament_name: string

    @Column(DataType.STRING)
    declare label_id: number

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
