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
     * 账号类型 空值-常规账号 betable-可用于投注的账号
     */
    @Column(DataType.STRING)
    declare type: string

    /**
     * 账户余额
     */
    @Column(DataType.DECIMAL)
    declare balance: CreationOptional<NumberVal>

    /**
     * 正在使用账号的机器
     */
    @Column(DataType.STRING)
    declare use_by: string

    /**
     * 账号持有有效期
     */
    @Column(DataType.DATE)
    declare use_expires: CreationOptional<Date>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>
}
