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
} from 'sequelize-typescript'

/**
 * 推荐记录表
 */
@Table({ tableName: 'promoted', timestamps: true, updatedAt: false })
export class Promoted extends Model<InferAttributes<Promoted>, InferCreationAttributes<Promoted>> {
    /**
     * 推荐id
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
    @AllowNull(false)
    @Column(DataType.SMALLINT)
    declare is_valid: CreationOptional<number>

    /**
     * 推荐无效的原因
     */
    @AllowNull(false)
    @Column(DataType.STRING)
    declare skip: CreationOptional<string>

    /**
     * 周起点日期标记
     */
    @Column(DataType.INTEGER)
    declare week_day: number

    /**
     * 周推荐序号
     */
    @AllowNull(false)
    @Column(DataType.INTEGER)
    declare week_id: CreationOptional<number>

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
    declare value: CreationOptional<string | null>

    /**
     * 输赢结果
     */
    @Column(DataType.TINYINT)
    declare result: CreationOptional<number | null>

    /**
     * 显示用的赛果
     */
    @Column(DataType.STRING)
    declare score: CreationOptional<string | null>

    /**
     * 主队赛果
     */
    @Column(DataType.TINYINT)
    declare score1: CreationOptional<number | null>

    /**
     * 客队赛果
     */
    @Column(DataType.TINYINT)
    declare score2: CreationOptional<number | null>

    /**
     * 扩展数据
     */
    @Column(DataType.JSON)
    declare extra: CreationOptional<any>

    /**
     * 推荐时间
     */
    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>
}
