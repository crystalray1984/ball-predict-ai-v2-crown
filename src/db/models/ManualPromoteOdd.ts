import { CreationOptional, InferCreationAttributes, type InferAttributes } from 'sequelize'
import {
    AutoIncrement,
    Column,
    CreatedAt,
    DataType,
    DeletedAt,
    Model,
    PrimaryKey,
    Table,
    UpdatedAt,
} from 'sequelize-typescript'

/**
 * 手动添加的推荐盘口
 */
@Table({ tableName: 'manual_promote_odd', paranoid: true })
export class ManualPromoteOdd extends Model<
    InferAttributes<ManualPromoteOdd>,
    InferCreationAttributes<ManualPromoteOdd>
> {
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    @Column(DataType.INTEGER)
    declare record_id: number

    @Column(DataType.INTEGER)
    declare match_id: number

    @Column(DataType.STRING)
    declare variety: string

    @Column(DataType.STRING)
    declare period: string

    @Column(DataType.DECIMAL(10, 2))
    declare condition: string

    @Column(DataType.STRING)
    declare type: string

    @Column(DataType.DECIMAL(10, 2))
    declare condition2: CreationOptional<string | null>

    @Column(DataType.STRING)
    declare type2: CreationOptional<string | null>

    @Column(DataType.INTEGER)
    declare promoted_odd_id: CreationOptional<number>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>

    @DeletedAt
    @Column(DataType.DATE)
    declare deleted_at: CreationOptional<Date | null>
}
