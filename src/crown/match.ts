import { delay } from '@/common/helpers'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Page } from 'puppeteer-core'
import { crownQueue, ready, xmlParser } from './base'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * 从皇冠页面获取比赛列表
 */
export async function getCrownMatches(): Promise<Crown.MatchInfo[]> {
    return crownQueue.add(async () => {
        const page = await ready()

        const func = `
(function () {
    var par = top.param;
    par += "&p=get_league_list_All";
    par += "&gtype=FT";
    par += "&showtype=fu";
    par += "&FS=N";
    par += "&rtype=r";
    par += "&date=all";
    par += "&nocp=N";
    par += "&ts=" + Date.now();

    var params = new URLSearchParams(par);
    params.set('langx', 'zh-cn');

    var getHTML = new HttpRequest;
    return new Promise((resolve, reject) => {
        getHTML.addEventListener("onError", reject);
        getHTML.addEventListener("LoadComplete", resolve);
        getHTML.loadURL(top.m2_url, "POST", params.toString())
    })
})()
`
        const resp = (await page.evaluate(func)) as string
        console.log('抓取皇冠联赛列表完成')
        // debugFileLog('matches', resp)
        const leagueList = xmlParser.parse(resp).serverresponse

        if (!leagueList.coupons || leagueList.coupons.coupon_sw !== 'Y') {
            console.log('没有找到皇冠联赛数据1')
            return []
        }

        //联赛id列表
        let lid: string
        if (Array.isArray(leagueList.coupons.coupon) && leagueList.coupons.coupon.length > 0) {
            lid = leagueList.coupons.coupon[0].lid
        } else if (
            typeof leagueList.coupons.coupon === 'object' &&
            leagueList.coupons.coupon &&
            typeof leagueList.coupons.coupon.lid === 'string'
        ) {
            lid = leagueList.coupons.coupon.lid
        } else {
            console.log('没有找到皇冠联赛数据2')
            return []
        }

        const lids = lid.split(',')
        let result: Crown.MatchInfo[] = []
        for (let start = 0; start < lids.length; start += 5) {
            const subList = lids.slice(start, start + 5)
            await delay(1000)
            result = result.concat(await getCrownMatchesWithLeagues(page, subList))
        }

        //读取联赛列表

        return result
    })
}

async function getCrownMatchesWithLeagues(page: Page, lids: string[]): Promise<Crown.MatchInfo[]> {
    const func2 = `
(function () {
    var par = top.param;
    par += "&p=get_game_list";
    par += "&p3type=";
    par += "&date=all";
    par += "&gtype=ft";
    par += "&showtype=early";
    par += "&rtype=r";
    par += "&ltype=" + top["userData"].ltype;
    par += "&filter=";
    par += "&cupFantasy=N";
    par += "&lid=" + ${JSON.stringify(lids.join(','))};
    // par += "&field=cp1";
    par += "&action=click_league";
    par += "&sorttype=L";
    par += "&specialClick=";
    par += "&isFantasy=N";
    par += "&ts=" + Date.now();

    var params = new URLSearchParams(par);
    params.set('langx', 'zh-cn');

    var getHTML = new HttpRequest;
    return new Promise((resolve, reject) => {
        getHTML.addEventListener("onError", reject);
        getHTML.addEventListener("LoadComplete", resolve);
        getHTML.loadURL(top.m2_url, "POST", params.toString())
    })
})()
`
    const respList = (await page.evaluate(func2)) as string
    console.log('抓取皇冠比赛列表完成')
    const gameList = xmlParser.parse(respList).serverresponse

    if (!Array.isArray(gameList.ec) || gameList.ec.length === 0) {
        console.log('未读取到皇冠比赛列表', lids)
        return []
    }

    const result: Crown.MatchInfo[] = []

    gameList.ec.forEach((ec: Record<string, any>) => {
        if (ec['@_hasEC'] !== 'Y' || !ec.game || ec.game.ISFANTASY === 'Y') return
        const game = ec.game as Record<string, string>
        result.push({
            lid: game.LID,
            league: game.LEAGUE,
            team_id_h: game.TEAM_H_ID,
            team_id_c: game.TEAM_C_ID,
            team_h: game.TEAM_H,
            team_c: game.TEAM_C,
            ecid: game.ECID,
            match_time: parseMatchTime(game.SYSTIME, game.DATETIME),
        })
    })

    return result
}

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

    const baseTime = dayjs.tz(SYSTIME, 'America/New_York')
    let matchTime = dayjs.tz(
        `${baseTime.year()}-${timeMatch[1]}-${timeMatch[2]} ${hour.toString().padStart(2, '0')}:${timeMatch[4]}`,
        'America/New_York',
    )

    if (Math.abs(baseTime.diff(matchTime, 'days')) > 120) {
        //比赛时间与当前时间相差不应过大，否则就年份+1
        matchTime = matchTime.add(1, 'year')
    }

    return matchTime.valueOf()
}
