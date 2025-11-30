import { CONFIG } from '@/config'
import { merge } from 'lodash'
import { Sequelize, SequelizeOptions } from 'sequelize-typescript'
import { CrownAccount } from './models/CrownAccount'
import { CrownOdd } from './models/CrownOdd'
import { LabelPromoted } from './models/LabelPromoted'
import { LuffaUser } from './models/LuffaUser'
import { Match } from './models/Match'
import { NotificationLog } from './models/NotificationLog'
import { Odd } from './models/Odd'
import { OddMansion } from './models/OddMansion'
import { Promoted } from './models/Promoted'
import { RockballOdd } from './models/RockballOdd'
import { Setting } from './models/Setting'
import { SurebetRecord } from './models/SurebetRecord'
import { Team } from './models/Team'
import { Titan007Odd } from './models/Titan007Odd'
import { Tournament } from './models/Tournament'
import { TournamentLabel } from './models/TournamentLabel'
import { VLabelPromoted } from './models/VLabelPromoted'
import { VLuffaUser } from './models/VLuffaUser'
import { VMatch } from './models/VMatch'
import { VPromoted } from './models/VPromoted'

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
                Setting,
                Team,
                Titan007Odd,
                Tournament,
                CrownAccount,
                VMatch,
                SurebetRecord,
                LuffaUser,
                VLuffaUser,
                NotificationLog,
                CrownOdd,
                TournamentLabel,
                LabelPromoted,
                VLabelPromoted,
                RockballOdd,
                OddMansion,
                Promoted,
                VPromoted,
            ],
        },
    ),
)

export { CrownAccount } from './models/CrownAccount'
export { CrownOdd } from './models/CrownOdd'
export { LabelPromoted } from './models/LabelPromoted'
export { LuffaUser } from './models/LuffaUser'
export { Match } from './models/Match'
export { NotificationLog } from './models/NotificationLog'
export { Odd } from './models/Odd'
export { OddMansion } from './models/OddMansion'
export { Promoted } from './models/Promoted'
export { RockballOdd } from './models/RockballOdd'
export { Setting } from './models/Setting'
export { SurebetRecord } from './models/SurebetRecord'
export { Team } from './models/Team'
export { Titan007Odd } from './models/Titan007Odd'
export { Tournament } from './models/Tournament'
export { TournamentLabel } from './models/TournamentLabel'
export { VLabelPromoted } from './models/VLabelPromoted'
export { VLuffaUser } from './models/VLuffaUser'
export { VMatch } from './models/VMatch'
export { VPromoted } from './models/VPromoted'
