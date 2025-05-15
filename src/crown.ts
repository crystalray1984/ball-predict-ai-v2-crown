import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import Decimal from 'decimal.js'
import { XMLParser } from 'fast-xml-parser'
import { machineIdSync } from 'node-machine-id'
import puppeteer, { Browser, Page } from 'puppeteer'
import { Op, literal } from 'sequelize'
import { CrownAccount, db } from './db'
import { delay, singleton } from './helpers'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * 设备ID
 */
const MACHINE_ID = machineIdSync()

/**
 * 浏览器进程实例
 */
let browser = undefined as unknown as Browser

/**
 * 页面实例
 */
let mainPage = undefined as unknown as Page

/**
 * 定时维持皇冠账号使用中的定时器
 */
let accountTimer = undefined as unknown as NodeJS.Timeout

/**
 * 皇冠账号
 */
let account = undefined as unknown as CrownAccount

/**
 * 上一次刷新页面的时间
 */
let lastActiveTime = Date.now()

/**
 * 等待页面的元素出现
 * @param page 页面对象
 * @param selector 元素选择器
 * @returns
 */
async function waitForElement(page: Page, selector: string, cancelToken?: { aborted: boolean }) {
    while (true) {
        try {
            const element = await page.$(selector)
            if (element) return true
            if (cancelToken?.aborted) return false
        } catch (err) {
            if (
                !(err instanceof Error) ||
                !err.message.includes('Execution context was destroyed')
            ) {
                throw err
            }
        }

        await delay(300)
    }
}

/**
 * 获取皇冠账号
 */
async function getCrownAccount() {
    const acc = await db.transaction(async (transaction) => {
        //先尝试返回当前使用的账号
        let acc = await CrownAccount.findOne({
            where: {
                status: 1,
                use_by: MACHINE_ID,
            },
            lock: transaction.LOCK.UPDATE,
            transaction,
        })

        if (acc) {
            await CrownAccount.update(
                {
                    use_expires: new Date(Date.now() + 300000),
                },
                {
                    where: {
                        id: acc.id,
                    },
                    transaction,
                },
            )
            return acc
        }

        //尝试寻找其他可用账号
        acc = await CrownAccount.findOne({
            where: {
                [Op.and]: [
                    { status: 1 },
                    {
                        [Op.or]: [
                            { use_by: '' },
                            {
                                use_expires: {
                                    [Op.lt]: literal('CURRENT_TIMESTAMP'),
                                },
                            },
                        ],
                    },
                ],
            },
            order: literal('RAND()'),
            lock: transaction.LOCK.UPDATE,
            transaction,
        })

        if (acc) {
            await CrownAccount.update(
                {
                    use_by: MACHINE_ID,
                    use_expires: new Date(Date.now() + 300000),
                },
                {
                    where: {
                        id: acc.id,
                    },
                    transaction,
                },
            )
        }
        return acc
    })

    if (!acc) {
        throw new Error('没有可用的皇冠账号')
    }

    accountTimer = setInterval(async () => {
        if (account) {
            await CrownAccount.update(
                {
                    use_expires: new Date(Date.now() + 300000),
                },
                {
                    where: {
                        id: account.id,
                        use_by: MACHINE_ID,
                    },
                },
            )
        }
    }, 120000)

    return acc
}

/**
 * 释放皇冠账号
 */
async function freeCrownAccount() {
    clearInterval(accountTimer)
    if (account) {
        await CrownAccount.update(
            {
                use_by: '',
            },
            {
                where: {
                    id: account.id,
                    use_by: MACHINE_ID,
                },
            },
        )
        account = undefined as unknown as CrownAccount
    }
}

/**
 * 初始化皇冠抓取环境
 */
export const initCrown = () =>
    singleton('initCrown', async () => {
        console.log(puppeteer.defaultArgs())

        //重置浏览器
        if (browser) {
            try {
                await browser.close()
            } catch {}
            browser = undefined as unknown as Browser
            mainPage = undefined as unknown as Page
            await freeCrownAccount()
        }

        account = await getCrownAccount()
        console.log('使用皇冠账号', account.username)

        //启动浏览器
        const args: string[] = ['--no-sandbox', '--disable-images', '--lang=zh-CN']
        browser = await puppeteer.launch({
            headless: false,
            args,
        })

        const page = await browser.newPage()
        await page.goto('https://mos011.com')
        console.log('page navigated')

        //等待登录脚本完成
        await waitForElement(page, '#usr')
        console.log('login form ready')
        await page.locator('#usr').fill(account.username)
        await page.locator('#pwd').fill(account.password)
        await page.locator('.check_remember.lab_radio').click()
        await page.locator('#btn_login').click()
        console.log('login form submitted')

        //等待数字密码的确认
        await waitForElement(page, '#C_popup_checkbox .lab_radio')
        await page.locator('#C_popup_checkbox .lab_radio').click()
        console.log('checkbox clicked')

        await page.locator('#C_no_btn').click()
        console.log('no_password clicked')

        await page.waitForNavigation()
        console.log(page.url())

        //等待主页加载完成
        await waitForElement(page, '#today_page')
        console.log('home page ready')

        mainPage = page
        lastActiveTime = Date.now()
    })

const refreshPage = () =>
    singleton('refreshPage', async () => {
        await mainPage.reload()
        //等待主页加载完成
        await waitForElement(mainPage, '#today_page')
        console.log('home page refresh')
        lastActiveTime = Date.now()
    })

/**
 * 等待页面准备完毕
 */
async function ready(skipRefresh = false) {
    if (!mainPage) {
        await initCrown()
    } else if (!skipRefresh && Date.now() - lastActiveTime >= 900000) {
        await refreshPage()
    }
}

/**
 * 负责解析XML数据的解析器
 */
const parser = new XMLParser({
    parseTagValue: false,
    processEntities: false,
    ignoreDeclaration: true,
    ignoreAttributes: false,
})

/**
 * 读取皇冠盘口数据
 * @param crown_match_id 皇冠比赛id
 * @param show_type 数据类型
 * @returns
 */
async function _getCrownData(
    crown_match_id: string,
    show_type: 'today' | 'early' = 'today',
    skipRefresh = false,
): Promise<Crown.OddData | undefined> {
    console.log('发起皇冠请求', crown_match_id, show_type)
    await ready(skipRefresh)

    const func = `
(function () {
    var par = top.param;
    par += "&p=get_game_more";
    par += "&gtype=ft";
    par += "&showtype=" + ${JSON.stringify(show_type)};
    par += "&ltype=" + top["userData"].ltype;
    par += "&isRB=N";
    par += "&specialClick=";
    par += "&mode=NORMAL";
    par += "&filter=All";
    par += "&ts=" + Date.now();
    par += "&ecid=" + ${JSON.stringify(crown_match_id)};

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

    const resp = (await mainPage.evaluate(func)) as string
    console.log('皇冠请求完成', crown_match_id, show_type)
    return formatOddData(parser.parse(resp).serverresponse)
}

/**
 * 整理盘口数据，只留下必要的参数
 */
function formatOddData(input: Crown.Resp) {
    if (!Array.isArray(input.game)) return

    /**
     * 主体比赛数据
     */
    const mainGame = input.game.find((t) => t.ptype_id === '0') ?? input.game[0]

    /**
     * 比赛主体数据
     */
    const match: Crown.MatchInfo = {
        match_time: 0,
        ecid: mainGame.ecid,
        league: mainGame.league,
        lid: mainGame.lid,
        team_c: mainGame.team_c,
        team_h: mainGame.team_h,
        team_id_c: mainGame.team_id_c,
        team_id_h: mainGame.team_id_h,
    }

    //盘口数据
    const odds: Crown.OddInfo[] = []
    input.game.forEach((game) => {
        //进球
        if (game.ptype_id === '0') {
            //全场让球
            if (game.sw_R === 'Y') {
                let condition = changeRatio(game.ratio)
                if (game.strong === 'H') {
                    //主队让球
                    condition = Decimal(0).sub(condition).toString()
                }
                const [value_h, value_c] = changeValue(game.ior_RH, game.ior_RC)
                odds.push({
                    variety: 'goal',
                    type: 'r',
                    condition,
                    value_h,
                    value_c,
                })
            }
            //半场让球
            if (game.sw_HR === 'Y') {
                let condition = changeRatio(game.hratio)
                if (game.hstrong === 'H') {
                    //主队让球
                    condition = Decimal(0).sub(condition).toString()
                }
                const [value_h, value_c] = changeValue(game.ior_HRH, game.ior_HRC)
                odds.push({
                    variety: 'goal',
                    type: 'hr',
                    condition,
                    value_h,
                    value_c,
                })
            }
            //全场大小球
            if (game.sw_OU === 'Y') {
                const [value_h, value_c] = changeValue(game.ior_OUH, game.ior_OUC)
                odds.push({
                    variety: 'goal',
                    type: 'ou',
                    condition: changeRatio(game.ratio_o),
                    value_h,
                    value_c,
                })
            }
            //半场大小球
            if (game.sw_HOU === 'Y') {
                const [value_h, value_c] = changeValue(game.ior_HOUH, game.ior_HOUC)
                odds.push({
                    variety: 'goal',
                    type: 'hou',
                    condition: changeRatio(game.ratio_ho),
                    value_h,
                    value_c,
                })
            }
        }
        //角球
        else if (game.ptype_id === '146') {
            //全场让球
            if (game.sw_R === 'Y') {
                let condition = changeRatio(game.ratio)
                if (game.strong === 'H') {
                    //主队让球
                    condition = Decimal(0).sub(condition).toString()
                }
                const [value_h, value_c] = changeValue(game.ior_RH, game.ior_RC)
                odds.push({
                    variety: 'corner',
                    type: 'r',
                    condition,
                    value_h,
                    value_c,
                })
            }
            //半场让球
            if (game.sw_HR === 'Y') {
                let condition = changeRatio(game.hratio)
                if (game.hstrong === 'H') {
                    //主队让球
                    condition = Decimal(0).sub(condition).toString()
                }
                const [value_h, value_c] = changeValue(game.ior_HRH, game.ior_HRC)
                odds.push({
                    variety: 'corner',
                    type: 'hr',
                    condition,
                    value_h,
                    value_c,
                })
            }
            //全场大小球
            if (game.sw_OU === 'Y') {
                const [value_h, value_c] = changeValue(game.ior_OUH, game.ior_OUC)
                odds.push({
                    variety: 'corner',
                    type: 'ou',
                    condition: changeRatio(game.ratio_o),
                    value_h,
                    value_c,
                })
            }
            //半场大小球
            if (game.sw_HOU === 'Y') {
                const [value_h, value_c] = changeValue(game.ior_HOUH, game.ior_HOUC)
                odds.push({
                    variety: 'corner',
                    type: 'hou',
                    condition: changeRatio(game.ratio_ho),
                    value_h,
                    value_c,
                })
            }
        }
    })

    return {
        match,
        odds,
    }
}

/**
 * 读取皇冠盘口数据
 * @param crown_match_id 皇冠比赛id
 * @param show_type 数据类型
 * @returns
 */
export async function getCrownData(
    crown_match_id: string,
    show_type: 'today' | 'early' = 'today',
    skipRefresh = false,
): Promise<Crown.OddData | undefined> {
    let tryCount = 3
    while (true) {
        try {
            return await _getCrownData(crown_match_id, show_type, skipRefresh)
        } catch (err) {
            console.error(err)
            console.log(err)
            console.log('重试次数', tryCount)
            tryCount--
            if (tryCount <= 0) {
                throw err
            }
            if (!skipRefresh) {
                await initCrown()
            }
        }
    }
}

/**
 * 计算皇冠的赔率，从原始的亚赔数据转换为欧赔
 * @param value1 主队赔率
 * @param value2 客队赔率
 */
function changeValue(value1: string, value2: string) {
    function chg_ior(iorH: number, iorC: number): [string, string] {
        iorH = Math.floor(iorH * 1e3 + 0.001) / 1e3
        iorC = Math.floor(iorC * 1e3 + 0.001) / 1e3
        if (iorH < 11) iorH *= 1e3
        if (iorC < 11) iorC *= 1e3
        iorH = parseFloat(iorH as unknown as string)
        iorC = parseFloat(iorC as unknown as string)
        const ior = get_EU_ior(iorH, iorC)
        ior[0] /= 1e3
        ior[1] /= 1e3
        return [printf(Decimal_point(ior[0], 100), 2), printf(Decimal_point(ior[1], 100), 2)]
    }

    function get_EU_ior(H_ratio: number, C_ratio: number): [number, number] {
        const out_ior = get_HK_ior(H_ratio, C_ratio)
        H_ratio = out_ior[0]
        C_ratio = out_ior[1]
        out_ior[0] = H_ratio + 1e3
        out_ior[1] = C_ratio + 1e3
        return out_ior
    }

    function get_HK_ior(H_ratio: number, C_ratio: number) {
        const out_ior = [] as unknown as [number, number]
        let line: number, lowRatio: number, nowRatio: number, highRatio: number
        let nowType = ''
        if (H_ratio <= 1e3 && C_ratio <= 1e3) {
            out_ior[0] = Math.floor(H_ratio / 10 + 1e-4) * 10
            out_ior[1] = Math.floor(C_ratio / 10 + 1e-4) * 10
            return out_ior
        }
        line = 2e3 - (H_ratio + C_ratio)
        if (H_ratio > C_ratio) {
            lowRatio = C_ratio
            nowType = 'C'
        } else {
            lowRatio = H_ratio
            nowType = 'H'
        }
        if (2e3 - line - lowRatio > 1e3) nowRatio = (lowRatio + line) * -1
        else nowRatio = 2e3 - line - lowRatio
        if (nowRatio < 0) highRatio = Math.floor(Math.abs(1e3 / nowRatio) * 1e3)
        else highRatio = 2e3 - line - nowRatio
        if (nowType == 'H') {
            out_ior[0] = Math.floor(lowRatio / 10 + 1e-4) * 10
            out_ior[1] = Math.floor(highRatio / 10 + 1e-4) * 10
        } else {
            out_ior[0] = Math.floor(highRatio / 10 + 1e-4) * 10
            out_ior[1] = Math.floor(lowRatio / 10 + 1e-4) * 10
        }
        return out_ior
    }

    function Decimal_point(tmpior: number, show: number) {
        var sign = ''
        sign = tmpior < 0 ? 'Y' : 'N'
        tmpior = Math.floor(Math.abs(tmpior) * show + 1 / show) / show
        return tmpior * (sign == 'Y' ? -1 : 1)
    }

    function printf(vals: number, points: number) {
        let strVals = '' + vals
        var cmd = new Array()
        cmd = strVals.split('.')
        if (cmd.length > 1)
            for (let ii = 0; ii < points - cmd[1].length; ii++) strVals = strVals + '0'
        else {
            strVals = strVals + '.'
            for (let ii = 0; ii < points; ii++) strVals = strVals + '0'
        }
        return strVals
    }

    return chg_ior(value1 as unknown as number, value2 as unknown as number)
}

/**
 * 计算让球值，从皇冠的带/的格式转换为2位小数
 * @param ratio 原始让球数值
 * @param strong 让球方，如果是用来计算大小球，那么传入C
 */
function changeRatio(ratio: string) {
    let parts = ratio.split('/').map((t) => t.trim())
    if (parts.length === 1) {
        //单个让球值
        return parts[0]
    } else {
        //两个让球值
        return Decimal(parts[0]).add(parts[1]).div(2).toString()
    }
}

/**
 * 抓取皇冠比赛列表
 */
export async function getCrownMatches(): Promise<Crown.MatchInfo[]> {
    await ready(true)

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
    const resp = (await mainPage.evaluate(func)) as string
    console.log('抓取皇冠联赛列表完成')
    const leagueList = parser.parse(resp).serverresponse

    if (
        !leagueList.coupons ||
        leagueList.coupons.coupon_sw !== 'Y' ||
        !Array.isArray(leagueList.coupons.coupon) ||
        leagueList.coupons.coupon.length === 0
    ) {
        console.log('没有找到皇冠比赛数据')
        return []
    }

    //联赛id列表
    const lid = leagueList.coupons.coupon[0].lid

    //读取联赛列表
    await delay(1000)

    const func2 = `
(function () {
    var par = top.param;
    par += "&p=get_game_list";
    par += "&p3type=";
    par += "&date=1";
    par += "&gtype=ft";
    par += "&showtype=early";
    par += "&rtype=r";
    par += "&ltype=" + top["userData"].ltype;
    par += "&filter=";
    par += "&cupFantasy=N";
    par += "&lid=" + ${JSON.stringify(lid)};
    par += "&field=cp1";
    par += "&action=clickCoupon";
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
    const respList = (await mainPage.evaluate(func2)) as string
    console.log('抓取皇冠比赛列表完成')
    const gameList = parser.parse(respList).serverresponse

    if (!Array.isArray(gameList.ec) || gameList.ec.length === 0) {
        console.log('未读取到皇冠比赛列表')
        return []
    }

    const result: Required<Crown.MatchInfo>[] = []

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

    //比赛时间不应小于当前时间，否则就年份+1
    if (matchTime.valueOf() < baseTime.valueOf()) {
        matchTime = matchTime.add(1, 'year')
    }

    return matchTime.valueOf()
}
