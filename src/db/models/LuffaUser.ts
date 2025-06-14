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

@Table({ tableName: 'luffa_user' })
export class LuffaUser extends Model<
    InferAttributes<LuffaUser>,
    InferCreationAttributes<LuffaUser>
> {
    @PrimaryKey
    @Column(DataType.STRING)
    declare uid: string

    @Column(DataType.SMALLINT)
    declare type: 0 | 1

    @Column(DataType.SMALLINT)
    declare open_push: CreationOptional<0 | 1>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>
}
