import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import {
    AutoIncrement,
    Column,
    CreatedAt,
    DataType,
    Model,
    PrimaryKey,
    Table,
} from 'sequelize-typescript'

/**
 * 消息通知记录表
 */
@Table({ tableName: 'notification_log', updatedAt: false })
export class NotificationLog extends Model<
    InferAttributes<NotificationLog>,
    InferCreationAttributes<NotificationLog>
> {
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    @Column(DataType.STRING)
    declare keyword: string

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @Column(DataType.STRING)
    declare category: CreationOptional<string>
}
