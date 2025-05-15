import 'reflect-metadata'

import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import {
    AutoIncrement,
    Column,
    CreatedAt,
    DataType,
    Model,
    PrimaryKey,
    Sequelize,
    Table,
    UpdatedAt,
} from 'sequelize-typescript'
import { CONFIG } from './config'

/**
 * 皇冠账号表
 */
@Table({ tableName: 'crown_account' })
export class CrownAccount extends Model<InferAttributes<CrownAccount>> {
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    @Column(DataType.STRING)
    declare username: string

    @Column(DataType.STRING)
    declare password: string

    @Column(DataType.TINYINT)
    declare status: number

    @Column(DataType.STRING)
    declare use_by: string

    @Column(DataType.DATE)
    declare use_expires: CreationOptional<Date | null>

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date | null>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date | null>
}

/**
 * 联赛表
 */
@Table({ tableName: 'tournament', timestamps: false })
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
}

/**
 * 队伍表
 */
@Table({ tableName: 'team', timestamps: false })
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
     * 队伍名称
     */
    @Column(DataType.STRING(100))
    declare name: string

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

/**
 * 比赛表
 */
@Table({ tableName: 'match' })
export class Match extends Model<InferAttributes<Match>, InferCreationAttributes<Match>> {
    /**
     * 比赛id
     */
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.INTEGER)
    declare id: CreationOptional<number>

    /**
     * 联赛id
     */
    @Column(DataType.INTEGER)
    declare tournament_id: number

    /**
     * 皇冠比赛id
     */
    @Column(DataType.STRING)
    declare crown_match_id: string

    /**
     * 球探网比赛id
     */
    @Column(DataType.STRING)
    declare titan007_match_id: CreationOptional<string>

    /**
     * 主队id
     */
    @Column(DataType.INTEGER)
    declare team1_id: number

    /**
     * 客队id
     */
    @Column(DataType.INTEGER)
    declare team2_id: number

    /**
     * 比赛时间
     */
    @Column(DataType.DATE)
    declare match_time: Date

    @CreatedAt
    @Column(DataType.DATE)
    declare created_at: CreationOptional<Date>

    @UpdatedAt
    @Column(DataType.DATE)
    declare updated_at: CreationOptional<Date>

    /**
     * 准备比赛
     */
    static async prepare(
        data: Pick<
            Crown.MatchInfo,
            'lid' | 'league' | 'team_c' | 'team_h' | 'team_id_c' | 'team_id_h'
        > & { match_time: number; crown_match_id: string },
    ): Promise<number> {
        //先看看比赛是否存在
        let match = await Match.findOne({
            where: {
                crown_match_id: data.crown_match_id,
            },
            attributes: ['id', 'match_time'],
        })
        if (match) {
            if (match.match_time.valueOf() !== data.match_time) {
                //更新比赛时间
                await Match.update(
                    {
                        match_time: new Date(data.match_time),
                    },
                    {
                        where: {
                            id: match.id,
                        },
                    },
                )
            }
            return match.id
        }

        //尝试获取联赛id
        const [tournament] = await Tournament.findOrCreate({
            where: {
                crown_tournament_id: data.lid,
            },
            defaults: {
                crown_tournament_id: data.lid,
                name: data.league,
            },
            attributes: ['id'],
        })

        //准备好队伍
        const team1_id = await Team.prepare(data.team_id_h, data.team_h)
        const team2_id = await Team.prepare(data.team_id_h, data.team_c)

        //插入比赛数据
        match = await Match.create(
            {
                tournament_id: tournament.id,
                crown_match_id: data.crown_match_id,
                team1_id,
                team2_id,
                match_time: new Date(data.match_time),
            },
            {
                returning: ['id'],
            },
        )

        return match.id
    }
}

/**
 * 数据库
 */
export const db = new Sequelize({
    dialect: 'postgres',
    timezone: '+08:00',
    ...CONFIG.db,
    models: [CrownAccount, Tournament, Team, Match],
})
