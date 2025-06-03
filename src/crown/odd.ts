import Decimal from 'decimal.js'
import { crownQueue, ready, xmlParser } from './base'
import { isDecimal } from '@/common/helpers'

/**
 * 读取皇冠盘口数据
 * @param crown_match_id 皇冠比赛id
 * @param show_type 数据类型
 * @returns
 */
export async function getCrownData(
    crown_match_id: string,
    show_type: 'today' | 'early' = 'today',
): Promise<Crown.OddData | undefined> {
    return crownQueue.add(async () => {
        console.log('发起皇冠请求', crown_match_id, show_type)
        const page = await ready()

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

    var getHTML = new HttpRequest();
    return new Promise((resolve, reject) => {
        getHTML.addEventListener("onError", reject);
        getHTML.addEventListener("LoadComplete", resolve);
        getHTML.loadURL(top.m2_url, "POST", params.toString())
    })
})()
`

        const resp = (await page.evaluate(func)) as string
        console.log('皇冠请求完成', crown_match_id, show_type)
        const data = xmlParser.parse(resp).serverresponse
        try {
            return formatOddData(data)
        } catch (err) {
            console.error('解析响应体失败', resp)
            throw err
        }
    })
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
            if (
                game.sw_R === 'Y' &&
                isDecimal(game.ratio) &&
                isDecimal(game.ior_RH) &&
                isDecimal(game.ior_RC)
            ) {
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
            if (
                game.sw_HR === 'Y' &&
                isDecimal(game.hratio) &&
                isDecimal(game.ior_HRH) &&
                isDecimal(game.ior_HRC)
            ) {
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
            if (
                game.sw_OU === 'Y' &&
                isDecimal(game.ratio_o) &&
                isDecimal(game.ior_OUH) &&
                isDecimal(game.ior_OUC)
            ) {
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
            if (
                game.sw_HOU === 'Y' &&
                isDecimal(game.ratio_ho) &&
                isDecimal(game.ior_HOUH) &&
                isDecimal(game.ior_HOUC)
            ) {
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
            if (
                game.sw_R === 'Y' &&
                isDecimal(game.ratio) &&
                isDecimal(game.ior_RH) &&
                isDecimal(game.ior_RC)
            ) {
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
            if (
                game.sw_HR === 'Y' &&
                isDecimal(game.hratio) &&
                isDecimal(game.ior_HRH) &&
                isDecimal(game.ior_HRC)
            ) {
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
            if (
                game.sw_OU === 'Y' &&
                isDecimal(game.ratio_o) &&
                isDecimal(game.ior_OUH) &&
                isDecimal(game.ior_OUC)
            ) {
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
            if (
                game.sw_HOU === 'Y' &&
                isDecimal(game.ratio_ho) &&
                isDecimal(game.ior_HOUH) &&
                isDecimal(game.ior_HOUC)
            ) {
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
 * 寻找匹配的盘口
 * @param info
 * @param odds
 */
export function findMatchedOdd(info: OddInfo, odds: Crown.OddInfo[]) {
    //类型筛选
    odds = odds.filter((odd) => {
        if (odd.variety !== info.variety) return false
        switch (odd.type) {
            case 'r':
                return ['ah1', 'ah2'].includes(info.type) && info.period === 'regularTime'
            case 'hr':
                return ['ah1', 'ah2'].includes(info.type) && info.period === 'period1'
            case 'ou':
                return ['over', 'under'].includes(info.type) && info.period === 'regularTime'
            case 'hou':
                return ['over', 'under'].includes(info.type) && info.period === 'period1'
        }
        return false
    })

    if (odds.length === 0) return []

    //把筛选到盘口，转换为跟surebet一致的数据结构
    switch (info.type) {
        case 'ah1':
            //让球主胜
            return odds.map((odd) => {
                return {
                    value: odd.value_h,
                    condition: odd.condition,
                }
            })
        case 'ah2':
            //让球客胜
            return odds.map((odd) => {
                return {
                    value: odd.value_c,
                    condition: Decimal(0).sub(odd.condition).toString(),
                }
            })
        case 'under':
            //小球
            return odds.map((odd) => ({
                value: odd.value_h,
                condition: odd.condition,
            }))
        case 'over':
            //大球
            return odds.map((odd) => ({
                value: odd.value_c,
                condition: odd.condition,
            }))
        default:
            return []
    }
}
