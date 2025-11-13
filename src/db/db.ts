import { CONFIG } from '@/config'
import { merge } from 'lodash'
import { Sequelize, SequelizeOptions } from 'sequelize-typescript'
import { CrownAccount } from './models/CrownAccount'
import { CrownOdd } from './models/CrownOdd'
import { LabelPromoted } from './models/LabelPromoted'
import { LuffaUser } from './models/LuffaUser'
import { ManualPromoteOdd } from './models/ManualPromoteOdd'
import { Match } from './models/Match'
import { NotificationLog } from './models/NotificationLog'
import { Odd } from './models/Odd'
import { PromotedOdd } from './models/PromotedOdd'
import { RockballOdd } from './models/RockballOdd'
import { RockballPromoted } from './models/RockballPromoted'
import { Setting } from './models/Setting'
import { SurebetRecord } from './models/SurebetRecord'
import { SurebetV2Odd } from './models/SurebetV2Odd'
import { SurebetV2Promoted } from './models/SurebetV2Promoted'
import { Team } from './models/Team'
import { Titan007Odd } from './models/Titan007Odd'
import { Tournament } from './models/Tournament'
import { TournamentLabel } from './models/TournamentLabel'
import { VLabelPromoted } from './models/VLabelPromoted'
import { VLuffaUser } from './models/VLuffaUser'
import { VMatch } from './models/VMatch'
import { VPromotedOdd } from './models/VPromotedOdd'
import { VRockballPromoted } from './models/VRockballPromoted'
import { VSurebetV2Promoted } from './models/VSurebetV2Promoted'

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
                CrownOdd,
                SurebetV2Odd,
                SurebetV2Promoted,
                VSurebetV2Promoted,
                TournamentLabel,
                LabelPromoted,
                VLabelPromoted,
                RockballOdd,
                RockballPromoted,
                VRockballPromoted,
            ],
        },
    ),
)

export { CrownAccount } from './models/CrownAccount'
export { CrownOdd } from './models/CrownOdd'
export { LabelPromoted } from './models/LabelPromoted'
export { LuffaUser } from './models/LuffaUser'
export { ManualPromoteOdd } from './models/ManualPromoteOdd'
export { Match } from './models/Match'
export { NotificationLog } from './models/NotificationLog'
export { Odd } from './models/Odd'
export { PromotedOdd } from './models/PromotedOdd'
export { RockballOdd } from './models/RockballOdd'
export { RockballPromoted } from './models/RockballPromoted'
export { Setting } from './models/Setting'
export { SurebetRecord } from './models/SurebetRecord'
export { SurebetV2Odd } from './models/SurebetV2Odd'
export { SurebetV2Promoted } from './models/SurebetV2Promoted'
export { Team } from './models/Team'
export { Titan007Odd } from './models/Titan007Odd'
export { Tournament } from './models/Tournament'
export { TournamentLabel } from './models/TournamentLabel'
export { VLabelPromoted } from './models/VLabelPromoted'
export { VLuffaUser } from './models/VLuffaUser'
export { VMatch } from './models/VMatch'
export { VPromotedOdd } from './models/VPromotedOdd'
export { VRockballPromoted } from './models/VRockballPromoted'
export { VSurebetV2Promoted } from './models/VSurebetV2Promoted'
