import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { AutoIncrement, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'

/**
 * 第二AI数据里缺失的比赛
 */
@Table({ tableName: 'ai2_miss_match', timestamps: false })
export class Ai2MissMatch extends Model<
    InferAttributes<Ai2MissMatch>,
    InferCreationAttributes<Ai2MissMatch>
> {
    /**
     * 球探网比赛id
     */
    @PrimaryKey
    @Column(DataType.STRING)
    declare match_id: string

    @Column(DataType.STRING)
    declare tournament_name: string

    @Column(DataType.STRING)
    declare team1_id: string

    @Column(DataType.STRING)
    declare team1_name: string

    @Column(DataType.STRING)
    declare team2_id: string

    @Column(DataType.STRING)
    declare team2_name: string

    @Column(DataType.DATE)
    declare match_time: Date
}
