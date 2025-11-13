import type { CreationOptional, InferAttributes } from 'sequelize'
import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'

/**
 * 滚球推荐视图
 */
@Table({ tableName: 'v_rockball_promoted' })
export class VRockballPromoted extends Model<InferAttributes<VRockballPromoted>> {
    /**
     * 盘口id
     */
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

    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>

    @Column(DataType.DECIMAL)
    declare value: CreationOptional<string>

    @Column(DataType.STRING)
    declare odd_type: 'ah' | 'sum'

    @Column(DataType.DATE)
    declare match_time: Date

    @Column(DataType.STRING)
    declare tournament_name: string

    @Column(DataType.STRING)
    declare team1_name: string

    @Column(DataType.STRING)
    declare team2_name: string
}
