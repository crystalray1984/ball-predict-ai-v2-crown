import { Column, DataType, Table } from 'sequelize-typescript'
import { Match } from './Match'

/**
 * 比赛视图
 */
@Table({ tableName: 'v_match' })
export class VMatch extends Match {
    @Column(DataType.STRING)
    declare tournament_name: string

    /**
     * 此联赛是否开启推荐
     */
    @Column(DataType.SMALLINT)
    declare tournament_is_open: number

    @Column(DataType.STRING)
    declare team1_titan007_id: string

    @Column(DataType.STRING)
    declare team1_name: string

    @Column(DataType.STRING)
    declare team2_titan007_id: string

    @Column(DataType.STRING)
    declare team2_name: string
}
