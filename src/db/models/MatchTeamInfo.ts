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
     * 扩展数据
     */
    @Column(DataType.JSONB)
    declare team1_info: TeamInfo

    /**
     * 扩展数据
     */
    @Column(DataType.JSONB)
    declare team2_info: TeamInfo
}
