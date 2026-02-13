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
 * 队伍表
 */
@Table({ tableName: 'team' })
export class Team extends Model<InferAttributes<Team>, InferCreationAttributes<Team>> {
    /**
     * 队伍id
     */
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    /**
     * 皇冠队伍id
     */
    @Column(DataType.STRING)
    declare crown_team_id: string

    /**
     * 球探网球队id
     */
    @Column(DataType.STRING)
    declare titan007_team_id: CreationOptional<string>

    /**
     * Fotmob球队id
     */
    @Column(DataType.STRING)
    declare fotmob_team_id: CreationOptional<string>

    /**
     * 队伍名称
     */
    @Column(DataType.STRING(100))
    declare name: string

    /**
     * 多语言队伍名称
     */
    @Column(DataType.JSONB)
    declare i18n_name: CreationOptional<Record<string, string> | null>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>

    /**
     * 队伍准备
     * @param crown_team_id
     * @param name
     */
    static async prepare(crown_team_id: string, name: string): Promise<number> {
        let team = await Team.findOne({
            where: {
                crown_team_id,
            },
            attributes: ['id'],
        })
        if (!team) {
            team = await Team.create(
                {
                    crown_team_id,
                    name,
                },
                {
                    returning: ['id'],
                },
            )
        }

        return team.id
    }
}
