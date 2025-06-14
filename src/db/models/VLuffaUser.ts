import type { InferAttributes } from 'sequelize'
import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'

/**
 * Luffa用户视图
 */
@Table({ tableName: 'v_luffa_user', timestamps: false })
export class VLuffaUser extends Model<InferAttributes<VLuffaUser>> {
    @PrimaryKey
    @Column(DataType.STRING)
    declare uid: string

    @Column(DataType.INTEGER)
    declare id: number

    @Column(DataType.INTEGER)
    declare status: number

    @Column(DataType.DATE)
    declare expire_time: Date
}
