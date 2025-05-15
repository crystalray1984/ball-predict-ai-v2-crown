import { Dayjs } from 'dayjs'
import { loadDoc, titan007Limiter } from './base'

/**
 * 读取指定日期的完场赛果
 * @param date
 */
export async function getFinalMatches(day: Dayjs): Promise<Titan007.TodayMatchInfo[]> {
    const lastDate = day.clone().add(-1, 'day')
    await titan007Limiter.next()

    try {
        //读取赛程列表
        const $ = await loadDoc(
            `https://bf.titan007.com/football/hg/Over_${day.format('YYYYMMDD')}.htm?finCookie=1`,
            undefined,
            'GBK',
        )

        const list = $('#table_live').find('tr[sid]')

        const output: Titan007.TodayMatchInfo[] = []

        const length = list.length
        for (let i = 0; i < length; i++) {
            const tr = list.eq(i)

            //判断是否完场
            const stateStr = tr.find('td').eq(2).text().trim()
            if (stateStr !== '完') continue

            //解析时间
            const timeStr = tr.find('td').eq(1).text()
            const match = /([0-9]+)日([0-9]+):([0-9]+)/.exec(timeStr)
            if (!match) continue
            const date = parseInt(match[1])
            let time: Date
            if (date === day.date()) {
                //今天
                time = day.clone().hour(parseInt(match[2])).minute(parseInt(match[3])).toDate()
            } else if (date === 1) {
                //跨月
                time = day
                    .clone()
                    .add(1, 'day')
                    .hour(parseInt(match[2]))
                    .minute(parseInt(match[3]))
                    .toDate()
            } else {
                //其他日期
                time = day
                    .clone()
                    .date(date)
                    .hour(parseInt(match[2]))
                    .minute(parseInt(match[3]))
                    .toDate()
            }

            const team1Cell = tr.find('td').eq(3)
            team1Cell.find('*').remove()
            const team1 = team1Cell
                .text()
                .trim()
                .replace(/[()]中[（）]/g, '')
                .replace(/[()（）]|\s/g, '')

            const team2Cell = tr.find('td').eq(5)
            team2Cell.find('*').remove('*')
            const team2 = team2Cell
                .text()
                .trim()
                .replace(/[()]中[（）]/g, '')
                .replace(/[()（）]|\s/g, '')

            output.push({
                match_id: tr.attr('sid')!,
                match_time: time.valueOf(),
                team1,
                team2,
                state: -1,
                team1_id: '',
                team2_id: '',
            })
        }
        return output
    } catch (err) {
        console.error(err)
        return []
    }
}
