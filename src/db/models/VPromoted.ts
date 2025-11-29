import type { InferAttributes } from 'sequelize'
import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'
import { Promoted } from './Promoted'

/**
 * 推荐记录视图
 */
@Table({ tableName: 'v_promoted' })
export class VPromoted extends Promoted {
    /**
     * 比赛时间
     */
    @Column(DataType.DATE)
    declare match_time: Date

    /**
     * 皇冠比赛id
     */
    @Column(DataType.STRING)
    declare crown_match_id: string

    /**
     * 赛事id
     */
    @Column(DataType.INTEGER)
    declare tournament_id: number

    /**
     * 赛事名称
     */
    @Column(DataType.STRING)
    declare tournament_name: string

    /**
     * 赛事标签id
     */
    @Column(DataType.INTEGER)
    declare tournament_label_id: number

    /**
     * 主队id
     */
    @Column(DataType.INTEGER)
    declare team1_id: number

    /**
     * 主队名称
     */
    @Column(DataType.STRING)
    declare team1_name: string

    /**
     * 客队id
     */
    @Column(DataType.INTEGER)
    declare team2_id: number

    /**
     * 客队名称
     */
    @Column(DataType.STRING)
    declare team2_name: string
}
