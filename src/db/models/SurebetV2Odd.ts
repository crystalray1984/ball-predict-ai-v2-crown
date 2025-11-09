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
 * V2系统推送过来的surebet盘口
 */
@Table({ tableName: 'surebet_v2_odd' })
export class SurebetV2Odd extends Model<
    InferAttributes<SurebetV2Odd>,
    InferCreationAttributes<SurebetV2Odd>
> {
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

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
     * 水位
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
    declare promote_id: CreationOptional<number>
}
