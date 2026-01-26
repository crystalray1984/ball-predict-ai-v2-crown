import type { CreationOptional, InferAttributes } from 'sequelize'
import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'

/**
 * 联赛标签表
 */
@Table({ tableName: 'tournament_label', timestamps: false })
export class TournamentLabel extends Model<InferAttributes<TournamentLabel>> {
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: number

    @Column(DataType.STRING)
    declare title: string

    @Column(DataType.STRING)
    declare luffa_uid: string

    @Column(DataType.INTEGER)
    declare luffa_type: number

    /**
     * 此联赛是否允许bmiss投注
     */
    @Column(DataType.TINYINT)
    declare bmiss_bet_enable: CreationOptional<number>
}
