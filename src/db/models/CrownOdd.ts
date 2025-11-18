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
 * 皇冠盘口追踪表
 */
@Table({ tableName: 'crown_odd', underscored: false })
export class CrownOdd extends Model<InferAttributes<CrownOdd>, InferCreationAttributes<CrownOdd>> {
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.BIGINT)
    declare id: CreationOptional<number>

    @Column(DataType.INTEGER)
    declare match_id: number

    @Column(DataType.STRING)
    declare crown_match_id: string

    @Column(DataType.STRING)
    declare variety: Variety

    @Column(DataType.STRING)
    declare period: Period

    @Column(DataType.STRING)
    declare type: OddIdentification

    @Column(DataType.DECIMAL(5, 2))
    declare condition: string

    @Column(DataType.DECIMAL(12, 6))
    declare value1: string

    @Column(DataType.DECIMAL(12, 6))
    declare value2: string

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>

    @Column(DataType.INTEGER)
    declare is_ignored: CreationOptional<number>

    @Column(DataType.INTEGER)
    declare promote_flag: CreationOptional<number>
}
