import axios from 'axios'
import { load } from 'cheerio'
import { titan007Limiter, USER_AGENT } from './base'

/**
 * 获取单场比赛的赛果
 * @param match_id
 */
export async function getMatchScore(
    match_id: string,
    swap: boolean | number,
    history = false,
): Promise<Titan007.MatchScore> {
    await titan007Limiter.next()

    //读取比分
    const respScore = await axios.request({
        url: `https://livestatic.titan007.com/flashdata/get`,
        params: {
            id: match_id,
            r: `007${Date.now()}`,
        },
        headers: {
            Referer: `https://live.titan007.com/detail/${match_id}sb.htm`,
            'User-Agent': USER_AGENT,
        },
        method: 'GET',
        responseType: 'text',
    })

    const scoreTexts = (respScore.data as string).split('^')
    let score1 = parseInt(scoreTexts[6])
    let score2 = parseInt(scoreTexts[7])
    let score1_period1 = parseInt(scoreTexts[15])
    let score2_period1 = parseInt(scoreTexts[16])

    if (isNaN(score1) || isNaN(score2) || isNaN(score1_period1) || isNaN(score2_period1)) {
        //尝试通过第二种方式获取
        await titan007Limiter.next()
        const respScore2 = await axios.request({
            url: `https://livestatic.titan007.com/phone/txt/analysisheader/cn/${match_id.substring(0, 1)}/${match_id.substring(1, 3)}/${match_id}.txt?${Date.now()}`,
            headers: {
                Referer: `https://live.titan007.com/detail/${match_id}sb.htm`,
                'User-Agent': USER_AGENT,
            },
            method: 'GET',
            responseType: 'text',
        })

        const scoreTexts = (respScore2.data as string).split('^')
        score1 = parseInt(scoreTexts[10])
        score2 = parseInt(scoreTexts[11])
        score1_period1 = parseInt(scoreTexts[26])
        score2_period1 = parseInt(scoreTexts[27])
    }

    //读取技术统计
    const { corner1, corner2, corner1_period1, corner2_period1 } = await getTechData(match_id)

    if (swap) {
        //交换主客
        return {
            score1: score2,
            score2: score1,
            score1_period1: score2_period1,
            score2_period1: score1_period1,
            corner1: corner2,
            corner2: corner1,
            corner1_period1: corner2_period1,
            corner2_period1: corner1_period1,
        }
    } else {
        return {
            score1,
            score2,
            score1_period1,
            score2_period1,
            corner1,
            corner2,
            corner1_period1,
            corner2_period1,
        }
    }
}

/**
 * 获取比赛数据统计
 * @param match_id
 */
async function getTechData(match_id: string): Promise<Titan007.TechData> {
    //先尝试通过页面获取
    const htmlData = await getTechDataFromHtml(match_id)
    if (Object.values(htmlData).some((t) => t === null)) {
        //再尝试通过JS获取
        try {
            const jsData = await getTechDataFromJs(match_id)
            Object.entries(htmlData).forEach(([key, value]) => {
                if (value === null && typeof jsData[key as keyof Titan007.TechData] === 'number') {
                    htmlData[key as keyof Titan007.TechData] =
                        jsData[key as keyof Titan007.TechData]
                }
            })
        } catch (err) {}
    }
    return htmlData
}

async function getTechDataFromJs(match_id: string): Promise<Titan007.TechData> {
    await titan007Limiter.next()
    const resp = await axios.request({
        url: 'https://livestatic.titan007.com/vbsxml/detailin.js',
        params: {
            r: `007${Date.now()}`,
            id: match_id,
        },
        headers: {
            Referer: 'https://live.titan007.com/oldIndexall.aspx',
            'User-Agent': USER_AGENT,
        },
        responseType: 'text',
    })

    const script = `${resp.data};\nShowBf(tT_f)`

    const data = await new Promise<Record<string, any>>((resolve, reject) => {
        function ShowBf(matches: any) {
            resolve(matches)
        }
        try {
            eval(script)
        } catch (err) {
            reject(err)
        }
    })

    if (!Array.isArray(data[match_id])) {
        return await getTechDataFromHtml(match_id)
    }

    let corner1: number | null = null
    let corner2: number | null = null
    let corner1_period1: number | null = null
    let corner2_period1: number | null = null

    const row0 = data[match_id].find((t) => t[0] === 0)
    if (row0) {
        corner1 = parseInt(row0[1])
        corner2 = parseInt(row0[2])
    }

    const row1 = data[match_id].find((t) => t[0] === 1)
    if (row1) {
        corner1_period1 = parseInt(row1[1])
        corner2_period1 = parseInt(row1[2])
    }

    return {
        corner1,
        corner2,
        corner1_period1,
        corner2_period1,
    }
}

/**
 * 通过页面获取比赛数据统计
 * @param match_id
 */
async function getTechDataFromHtml(match_id: string): Promise<Titan007.TechData> {
    await titan007Limiter.next()
    const resp = await axios.request({
        url: `https://live.titan007.com/detail/${match_id}sb.htm`,
        headers: {
            Referer: 'https://live.titan007.com/oldIndexall.aspx',
            'User-Agent': USER_AGENT,
        },
        responseType: 'text',
    })

    let corner1: number | null = null
    let corner2: number | null = null
    let corner1_period1: number | null = null
    let corner2_period1: number | null = null

    const $ = load(resp.data)
    const lists = $('#teamTechDiv > .lists')
    lists.each((_1, el) => {
        //通过内容判断
        const div = $(el).find('div.data')
        if (div.length === 0) return
        const label = div.find('span').eq(1).text().trim()
        if (label === '角球') {
            corner1 = parseInt(div.find('span').eq(0).text().trim())
            corner2 = parseInt(div.find('span').eq(2).text().trim())
        } else if (label === '半场角球') {
            corner1_period1 = parseInt(div.find('span').eq(0).text().trim())
            corner2_period1 = parseInt(div.find('span').eq(2).text().trim())
        }
    })

    return {
        corner1,
        corner2,
        corner1_period1,
        corner2_period1,
    }
}
