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
 * Bmiss投注用的皇冠主盘表
 */
@Table({ tableName: 'crown_main_odd', underscored: false, updatedAt: false })
export class CrownMainOdd extends Model<
    InferAttributes<CrownMainOdd>,
    InferCreationAttributes<CrownMainOdd>
> {
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    @Column(DataType.INTEGER)
    declare match_id: number

    @Column(DataType.STRING)
    declare base: 'ah' | 'sum' | 'win'

    @Column(DataType.TINYINT)
    declare is_active: number

    @Column(DataType.STRING)
    declare hash: string

    @Column(DataType.DECIMAL)
    declare condition: string

    @Column(DataType.DECIMAL)
    declare value1: string

    @Column(DataType.DECIMAL)
    declare value2: string

    @Column(DataType.DECIMAL)
    declare value0: CreationOptional<string>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>
}
