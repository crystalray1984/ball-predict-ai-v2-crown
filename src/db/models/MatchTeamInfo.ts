import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { AllowNull, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript'

/**
 * 赛前队伍的实力统计
 */
@Table({ tableName: 'match_team_info', timestamps: false, underscored: false })
export class MatchTeamInfo extends Model<
    InferAttributes<MatchTeamInfo>,
    InferCreationAttributes<MatchTeamInfo>
> {
    /**
     * 比赛id
     */
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare match_id: number

    /**
     * 主队进球数
     */
    @AllowNull(true)
    @Column(DataType.INTEGER)
    declare team1_goals_scored: CreationOptional<number | null>

    /**
     * 主队丢球数
     */
    @AllowNull(true)
    @Column(DataType.INTEGER)
    declare team1_goals_allowed: CreationOptional<number | null>

    /**
     * 主队比赛场次
     */
    @Column(DataType.INTEGER)
    declare team1_matches: CreationOptional<number>

    /**
     * 客队进球数
     */
    @AllowNull(true)
    @Column(DataType.INTEGER)
    declare team2_goals_scored: CreationOptional<number | null>

    /**
     * 客队丢球数
     */
    @AllowNull(true)
    @Column(DataType.INTEGER)
    declare team2_goals_allowed: CreationOptional<number | null>

    /**
     * 客队比赛场次
     */
    @Column(DataType.INTEGER)
    declare team2_matches: CreationOptional<number>
}
