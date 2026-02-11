import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

const TIMEZONE = '-04:00'

/**
 * 解析皇冠比赛时间
 * @param SYSTIME
 * @param DATETIME
 * @returns
 */
function parseMatchTime(SYSTIME: string, DATETIME: string) {
    const timeMatch = /([0-9]+)-([0-9]+) ([0-9]+):([0-9]+)(a|p)/.exec(DATETIME)!

    let hour = parseInt(timeMatch[3])
    if (timeMatch[5] === 'p') {
        hour += 12
    }

    const baseTime = dayjs.tz(SYSTIME, TIMEZONE)
    let matchTime = dayjs.tz(
        `${baseTime.year()}-${timeMatch[1]}-${timeMatch[2]} ${hour.toString().padStart(2, '0')}:${timeMatch[4]}`,
        TIMEZONE,
    )

    //比赛时间不应小于当前时间，否则就年份+1
    if (matchTime.valueOf() < baseTime.valueOf()) {
        matchTime = matchTime.add(1, 'year')
    }

    return matchTime.valueOf()
}

console.log(parseMatchTime('2026-02-11 01:42:04', '02-11 03:30p'))
