import { AiConfig } from '@/config'
import { VMatch } from '@/db'
import axios from 'axios'
import dayjs from 'dayjs'

interface CozeResult extends Record<string, any> {
    '上半场大0.5': string
}

interface CozeResponse {
    result: CozeResult
}

interface CozeData {
    back: number
    note: string
    is_open: number
}

/**
 * 扣子AI模型预测数据
 */
export async function coze(
    config: AiConfig,
    match: Pick<VMatch, 'team1_name' | 'team2_name' | 'tournament_name' | 'match_time'>,
): Promise<CozeData> {
    const resp = await axios.request<CozeResponse>({
        method: 'POST',
        url: config.url,
        headers: {
            Authorization: `Bearer ${config.token}`,
        },
        data: {
            league: match.tournament_name,
            match_time: dayjs(match.match_time).format('YYYY/MM/DD HH:mm'),
            home_team: match.team1_name,
            away_team: match.team2_name,
        },
    })

    if (!resp.data.result) {
        return {
            back: 0,
            is_open: 0,
            note: '',
        }
    }

    const note = Object.entries(resp.data.result)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n')

    switch (resp.data.result['上半场大0.5']) {
        case '大':
            return {
                back: 0,
                is_open: 1,
                note,
            }
        case '小':
            return {
                back: 1,
                is_open: 1,
                note,
            }
        default:
            return {
                back: 0,
                is_open: 0,
                note,
            }
    }
}
