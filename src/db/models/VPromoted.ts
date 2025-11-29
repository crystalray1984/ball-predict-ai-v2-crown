import type { InferAttributes } from 'sequelize'
import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'

/**
 * 推荐记录视图
 */
@Table({ tableName: 'v_promoted', timestamps: false })
export class VPromoted extends Model<InferAttributes<VPromoted>> {
    /**
     * 推荐id
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
     * 数据源类型
     */
    @Column(DataType.STRING)
    declare source_type: string

    /**
     * 数据源id
     */
    @Column(DataType.INTEGER)
    declare source_id: number

    /**
     * 推荐频道
     */
    @Column(DataType.STRING)
    declare channel: string

    /**
     * 是否为有效推荐
     */
    @Column(DataType.SMALLINT)
    declare is_valid: number

    /**
     * 推荐无效的原因
     */
    @Column(DataType.STRING)
    declare skip: string

    /**
     * 周起点日期标记
     */
    @Column(DataType.INTEGER)
    declare week_day: number

    /**
     * 周推荐序号
     */
    @Column(DataType.INTEGER)
    declare week_id: number

    /**
     * 投注目标
     */
    @Column(DataType.STRING)
    declare variety: Variety

    /**
     * 投注时段
     */
    @Column(DataType.STRING)
    declare period: Period

    /**
     * 投注方向
     */
    @Column(DataType.STRING)
    declare type: OddType

    /**
     * 投注方向类型
     */
    @Column(DataType.STRING)
    declare odd_type: OddIdentification

    /**
     * 投注盘口
     */
    @Column(DataType.DECIMAL)
    declare condition: string

    /**
     * 推荐水位
     */
    @Column(DataType.DECIMAL)
    declare value: string | null

    /**
     * 输赢结果
     */
    @Column(DataType.TINYINT)
    declare result: number | null

    /**
     * 显示用的赛果
     */
    @Column(DataType.STRING)
    declare score: string | null

    /**
     * 主队赛果
     */
    @Column(DataType.TINYINT)
    declare score1: number | null

    /**
     * 客队赛果
     */
    @Column(DataType.TINYINT)
    declare score2: number | null

    /**
     * 扩展数据
     */
    @Column(DataType.JSON)
    declare extra: any

    /**
     * 推荐时间
     */
    @Column(DataType.DATE)
    declare created_at: Date

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
