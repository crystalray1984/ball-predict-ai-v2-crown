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
 * 皇冠账号表
 */
@Table({ tableName: 'crown_account' })
export class CrownAccount extends Model<
    InferAttributes<CrownAccount>,
    InferCreationAttributes<CrownAccount>
> {
    /**
     * 账号id
     */
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    /**
     * 用户名
     */
    @Column(DataType.STRING)
    declare username: string

    /**
     * 密码
     */
    @Column(DataType.STRING)
    declare password: string

    /**
     * 账号状态 1-正常 0-已失效
     */
    @Column(DataType.TINYINT)
    declare status: number

    /**
     * 正在使用账号的机器
     */
    @Column(DataType.STRING)
    declare use_by: string

    /**
     * 账号持有有效期
     */
    @Column(DataType.DATE)
    declare use_expires: CreationOptional<Date | null>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date | null>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date | null>
}
