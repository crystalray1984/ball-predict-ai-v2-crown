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
 * 队伍表
 */
@Table({ tableName: 'surebet_record', updatedAt: false })
export class SurebetRecord extends Model<
    InferAttributes<SurebetRecord>,
    InferCreationAttributes<SurebetRecord>
> {
    /**
     * 队伍id
     */
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    @Column(DataType.STRING)
    declare crown_match_id: string

    @Column(DataType.DATE)
    declare match_time: Date

    @Column(DataType.STRING)
    declare team1: CreationOptional<string>

    @Column(DataType.STRING)
    declare team2: CreationOptional<string>

    @Column(DataType.STRING)
    declare game: string

    @Column(DataType.STRING)
    declare base: string

    @Column(DataType.STRING)
    declare variety: string

    @Column(DataType.STRING)
    declare period: string

    @Column(DataType.STRING)
    declare type: string

    @Column(DataType.STRING)
    declare condition: string | null

    @Column(DataType.STRING)
    declare value: string

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>
}
