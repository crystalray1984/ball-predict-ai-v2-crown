import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import {
    Column,
    CreatedAt,
    DataType,
    Model,
    PrimaryKey,
    Table,
    UpdatedAt,
} from 'sequelize-typescript'

/**
 * 可投注的比赛表
 */
@Table({ tableName: 'f_match', underscored: false })
export class FMatch extends Model<InferAttributes<FMatch>, InferCreationAttributes<FMatch>> {
    /**
     * 比赛id
     */
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare match_id: number

    /**
     * 让球
     */
    @Column(DataType.DECIMAL)
    declare ah_condition: string

    /**
     * 让球主队水位
     */
    @Column(DataType.DECIMAL)
    declare ah1_value: string

    /**
     * 让球客队水位
     */
    @Column(DataType.DECIMAL)
    declare ah2_value: string

    @Column(DataType.STRING)
    declare ah_hash: string

    @Column(DataType.TINYINT)
    declare win_open: number

    @Column(DataType.STRING)
    declare win_hash: CreationOptional<string>

    @Column(DataType.DECIMAL)
    declare win1_value: CreationOptional<string>

    @Column(DataType.DECIMAL)
    declare win2_value: CreationOptional<string>

    @Column(DataType.DECIMAL)
    declare draw_value: CreationOptional<string>

    @Column(DataType.TINYINT)
    declare ou_open: number

    @Column(DataType.DECIMAL)
    declare ou_condition: CreationOptional<string>

    @Column(DataType.STRING)
    declare ou_hash: CreationOptional<string>

    @Column(DataType.DECIMAL)
    declare under_value: CreationOptional<string>

    @Column(DataType.DECIMAL)
    declare over_value: CreationOptional<string>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>
}
