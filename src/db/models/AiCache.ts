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
 * AI解析结果缓存表
 */
@Table({ tableName: 'ai_cache', updatedAt: false, underscored: false })
export class AiCache extends Model<InferAttributes<AiCache>, InferCreationAttributes<AiCache>> {
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    /**
     * 测算目标标识
     */
    @Column(DataType.STRING)
    declare target: string

    /**
     * 模型标识
     */
    @Column(DataType.STRING)
    declare provider: string

    /**
     * 响应体
     */
    @Column(DataType.JSONB)
    declare response: any

    /**
     * 测算时间
     */
    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>
}
