import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { AutoIncrement, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'

/**
 * 标签推荐表
 */
@Table({ tableName: 'label_promoted', timestamps: false })
export class LabelPromoted extends Model<
    InferAttributes<LabelPromoted>,
    InferCreationAttributes<LabelPromoted>
> {
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    @Column(DataType.INTEGER)
    declare promote_id: number

    @Column(DataType.INTEGER)
    declare label_id: number

    @Column(DataType.INTEGER)
    declare week_day: number

    @Column(DataType.INTEGER)
    declare week_id: CreationOptional<number>
}
