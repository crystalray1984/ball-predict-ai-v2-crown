import { CONFIG } from '@/config'
import { merge } from 'lodash'
import { Sequelize, SequelizeOptions } from 'sequelize-typescript'
import { CrownAccount } from './models/CrownAccount'
import { Match } from './models/Match'
import { Odd } from './models/Odd'
import { PromotedOdd } from './models/PromotedOdd'
import { Setting } from './models/Setting'
import { Team } from './models/Team'
import { Titan007Odd } from './models/Titan007Odd'
import { Tournament } from './models/Tournament'
import { VMatch } from './models/VMatch'

/**
 * 数据库连接
 */
export const db = new Sequelize(
    merge<SequelizeOptions, SequelizeOptions, SequelizeOptions>(
        {
            logging: false,
        },
        CONFIG.db,
        {
            dialect: 'mysql',
            timezone: '+08:00',
            models: [
                Match,
                Odd,
                PromotedOdd,
                Setting,
                Team,
                Titan007Odd,
                Tournament,
                CrownAccount,
                VMatch,
            ],
        },
    ),
)

export { CrownAccount } from './models/CrownAccount'
export { Match } from './models/Match'
export { Odd } from './models/Odd'
export { PromotedOdd } from './models/PromotedOdd'
export { Setting } from './models/Setting'
export { Team } from './models/Team'
export { Titan007Odd } from './models/Titan007Odd'
export { Tournament } from './models/Tournament'
export { VMatch } from './models/VMatch'
