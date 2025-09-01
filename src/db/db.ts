import { CONFIG } from '@/config'
import { merge } from 'lodash'
import { Sequelize, SequelizeOptions } from 'sequelize-typescript'
import { CrownAccount } from './models/CrownAccount'
import { LuffaUser } from './models/LuffaUser'
import { ManualPromoteOdd } from './models/ManualPromoteOdd'
import { Match } from './models/Match'
import { NotificationLog } from './models/NotificationLog'
import { Odd } from './models/Odd'
import { PromotedOdd } from './models/PromotedOdd'
import { PromotedOddChannel2 } from './models/PromotedOddChannel2'
import { Setting } from './models/Setting'
import { SurebetRecord } from './models/SurebetRecord'
import { Team } from './models/Team'
import { Titan007Odd } from './models/Titan007Odd'
import { Tournament } from './models/Tournament'
import { VLuffaUser } from './models/VLuffaUser'
import { VMatch } from './models/VMatch'
import { VPromotedOdd } from './models/VPromotedOdd'
import { VPromotedOddChannel2 } from './models/VPromotedOddChannel2'

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
            dialect: 'postgres',
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
                SurebetRecord,
                ManualPromoteOdd,
                LuffaUser,
                VLuffaUser,
                VPromotedOdd,
                NotificationLog,
                PromotedOddChannel2,
                VPromotedOddChannel2,
            ],
        },
    ),
)

export { CrownAccount } from './models/CrownAccount'
export { LuffaUser } from './models/LuffaUser'
export { ManualPromoteOdd } from './models/ManualPromoteOdd'
export { Match } from './models/Match'
export { NotificationLog } from './models/NotificationLog'
export { Odd } from './models/Odd'
export { PromotedOdd } from './models/PromotedOdd'
export { PromotedOddChannel2 } from './models/PromotedOddChannel2'
export { Setting } from './models/Setting'
export { SurebetRecord } from './models/SurebetRecord'
export { Team } from './models/Team'
export { Titan007Odd } from './models/Titan007Odd'
export { Tournament } from './models/Tournament'
export { VLuffaUser } from './models/VLuffaUser'
export { VMatch } from './models/VMatch'
export { VPromotedOdd } from './models/VPromotedOdd'
export { VPromotedOddChannel2 } from './models/VPromotedOddChannel2'
