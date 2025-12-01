import axios from 'axios'
import { URLSearchParams } from 'node:url'
import { crownQueue, ready } from './base'
import { load } from 'cheerio'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * 采集皇冠的赛果
 * @param date 日期
 */
export function getCrownScore(date: string): Promise<Crown.ScoreInfo[]> {
    return crownQueue.add(async () => {
        console.log('采集皇冠赛果', date)

        const page = await ready()

        const func = `
(function () {
    return {
        param: top.param,
        oldSite: top.oldSite
    }
})()
`

        const resp = (await page.evaluate(func)) as {
            param: string
            oldSite: string
        }

        if (!resp.oldSite) return []
        if (!resp.param) return []

        const params = new URLSearchParams(resp.param)
        const uid = params.get('uid')
        if (!uid) return []

        //构建请求
        const respHtml = await axios.request<string>({
            url: `http://${resp.oldSite}/app/member/account/result/result.php`,
            params: {
                uid,
                game_type: 'FT',
                list_date: date,
                langx: 'zh-cn',
            },
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
                cookie: 'protocolstr_pc=https; test=init',
            },
            responseType: 'text',
        })

        //解析比赛id列表
        const match = /var myleg = new Array\((.+?)\)/.exec(respHtml.data)
        if (!match) return []
        const ids = match[1]
            .split(',')
            .map((item) => {
                if (item.startsWith("'")) {
                    item = item.substring(1)
                }
                if (item.endsWith("'")) {
                    item = item.substring(0, item.length - 1)
                }
                return item
            })
            .filter((t) => t !== '')

        const $ = load(respHtml.data)

        const result: any[] = []

        for (const id of ids) {
            const rowTeamHome = $(`#TR_${id}`)
            const rowTeamGuest = $(`#TR_1_${id}`)
            if (rowTeamHome.length === 0 || rowTeamGuest.length === 0) continue

            //比赛时间
            let timeText = rowTeamHome.find('.acc_result_time').text()
            const timeMatch = /([0-9]{2}:[0-9]{2})(a|p)/.exec(timeText)
            if (!timeMatch) {
                continue
            }

            let match_dayjs = dayjs.tz(`${date} ${timeMatch[1]}`, 'YYYY-MM-DD HH:mm', '-04:00')
            if (timeMatch[2] === 'p') {
                match_dayjs = match_dayjs.add(12, 'hour')
            }

            const team1 = (rowTeamHome.find('.acc_result_team').html() ?? '')
                .replace(/&nbsp;/g, '')
                .trim()
            const team2 = (rowTeamGuest.find('.acc_result_team').html() ?? '')
                .replace(/&nbsp;/g, '')
                .trim()
            const score1 = parseInt(rowTeamHome.find('.acc_result_full').text().trim())
            const score2 = parseInt(rowTeamGuest.find('.acc_result_full').text().trim())
            const score1_period1 = parseInt(rowTeamHome.find('.acc_result_bg').text().trim())
            const score2_period1 = parseInt(rowTeamGuest.find('.acc_result_bg').text().trim())

            if (isNaN(score1) || isNaN(score2) || isNaN(score1_period1) || isNaN(score2_period1)) {
                continue
            }

            result.push({
                league_id: id.split('_')[0],
                match_time: match_dayjs.valueOf(),
                team1,
                team2,
                score1,
                score2,
                score1_period1,
                score2_period1,
            })
        }

        return result
    })
}
