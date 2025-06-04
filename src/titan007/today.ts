import axios from 'axios'
import { titan007Limiter, USER_AGENT } from './base'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * 获取皇冠网今日实时数据
 */
export async function getTodayMatches() {
    await titan007Limiter.next()

    //读取赛程列表
    const resp = await axios.request({
        url: 'https://livestatic.titan007.com/vbsxml/bfdata_ut.js',
        params: {
            r: `007${Date.now()}`,
        },
        headers: {
            Referer: 'https://live.titan007.com/oldIndexall.aspx',
            'User-Agent': USER_AGENT,
        },
        responseType: 'text',
    })

    const script = (resp.data as string).replace('ShowBf()', 'ShowBf(A)')

    const matches = await new Promise<string[][]>((resolve, reject) => {
        function ShowBf(matches: any) {
            resolve(matches)
        }
        try {
            eval(script)
        } catch (err) {
            reject(err)
        }
    })

    await titan007Limiter.next()
    //处理名称翻译
    const respAlias = await axios.request({
        url: `https://livestatic.titan007.com/vbsxml/alias3.txt`,
        params: {
            r: `007${Date.now()}`,
        },
        headers: {
            Referer: 'https://live.titan007.com/oldIndexall.aspx',
            'User-Agent': USER_AGENT,
        },
        responseType: 'text',
    })

    //解析队伍名称
    const alias = Object.fromEntries(
        (respAlias.data as string).split(',').map((row) => {
            const parts = row.split('^')
            return [parts[0], parts[2].replace(/[()（）]|\s/g, '')]
        }),
    )

    const formatMatch = (row: string[]): Titan007.TodayMatchInfo => {
        // const date_sl = row[11].split(':')
        // const date_sl2 = row[36].split('-')
        const time = dayjs
            .tz(`${row[43]}-${row[36]} ${row[11]}`, 'YYYY-M-D H:m', 'Asia/Shanghai')
            .toDate()
        // const time = new Date(
        //     parseInt(row[43]),
        //     parseInt(date_sl2[0]) - 1,
        //     parseInt(date_sl2[1]),
        //     parseInt(date_sl[0]),
        //     parseInt(date_sl[1]),
        //     0,
        //     0,
        // )

        const team1_id = row[37]
        const team2_id = row[38]

        const result = {
            match_id: row[0],
            match_time: time.valueOf(),
            raw_time: `${row[43]}-${row[36]} ${row[11]}`,
            team1_id,
            team1:
                alias[team1_id] ??
                row[5]
                    .replace(/<font.+?<\/font>/i, '')
                    .replace(/[()]中[（）]/g, '')
                    .replace(/[()（）]|\s/g, ''),
            team2_id,
            team2:
                alias[team2_id] ??
                row[8]
                    .replace(/<font.+?<\/font>/i, '')
                    .replace(/[()]中[（）]/g, '')
                    .replace(/[()（）]|\s/g, ''),
            state: parseInt(row[13]),
        }

        return result
    }

    return matches.map(formatMatch).filter((t) => !!t)
}
