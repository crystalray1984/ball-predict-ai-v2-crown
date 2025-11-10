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
 * 联赛表
 */
@Table({ tableName: 'tournament' })
export class Tournament extends Model<
    InferAttributes<Tournament>,
    InferCreationAttributes<Tournament>
> {
    /**
     * 联赛id
     */
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    /**
     * 皇冠联赛id
     */
    @Column(DataType.STRING)
    declare crown_tournament_id: string

    /**
     * 联赛名称
     */
    @Column(DataType.STRING)
    declare name: string

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>

    /**
     * 此联赛是否开启推荐
     */
    @Column(DataType.SMALLINT)
    declare is_open: CreationOptional<number>

    /**
     * 标签id
     */
    @Column(DataType.INTEGER)
    declare label_id: CreationOptional<number>
}
