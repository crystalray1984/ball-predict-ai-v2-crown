import axios from 'axios'
import { load } from 'cheerio'

/**
 * 网址来源网站地址
 */
const SITE_URL = 'http://ps3088.com/'

/**
 * 测速超时时间
 */
const TIMEOUT = 10000

/**
 * 测速次数
 */
const SPEED_TEST_TIMES = 5

/**
 * 从来源网站收集入口地址信息
 */
async function getSiteLinks(): Promise<string[]> {
    //读取网页内容
    const resp = await axios.request({
        url: SITE_URL,
        responseType: 'text',
    })

    const $ = load(resp.data)

    const links: string[] = []

    $('#list1 li').each((_, el) => {
        const node = $(el)
        if (node.hasClass('listgc')) return
        const link = node.find('a').attr('title')
        if (link) {
            links.push(link)
        }
    })

    for (let i = links.length - 1; i >= 0; i--) {
        const url = new URL(links[i])
        const domain = url.hostname.split('.')
        if (domain.length > 2 && domain[0] === 'www') {
            domain.shift()
            const hostname = domain.join('.')
            const regex = new RegExp(`/${hostname}$`)
            if (links.some((t) => regex.test(t))) {
                links.splice(i, 1)
            }
        }
    }

    return links
}

/**
 * 网址测速
 * @param url
 */
async function speedTest(url: string) {
    let speed = 0
    let success = 0
    let fail = 0
    for (let i = 0; i < SPEED_TEST_TIMES; i++) {
        try {
            const now = Date.now()
            await axios.request({
                method: 'POST',
                url,
                responseType: 'text',
                timeout: TIMEOUT,
            })
            speed += Date.now() - now
            success++
        } catch {
            fail++
        }
    }
    if (success > 0) {
        speed = Math.ceil(speed / success)
    }
    return {
        speed,
        success,
        fail,
    }
}

export async function getSpeeds() {
    const links = await getSiteLinks()
    return await Promise.all(
        links.map(async (url) => {
            return {
                url,
                speed: await speedTest(url),
            }
        }),
    )
}

/**
 * 启动主进程
 */
async function main() {
    const speeds = await getSpeeds()
    console.log(speeds)
}

if (require.main === module) {
    main()
}
