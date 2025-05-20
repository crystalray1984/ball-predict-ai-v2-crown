import { delay } from '@/common/helpers'
import { sendNotification } from '@/common/luffa'
import { Queue } from '@/common/queue'
import { singleton } from '@/common/singleton'
import { CrownAccount, db } from '@/db'
import { XMLParser } from 'fast-xml-parser'
import { machineIdSync } from 'node-machine-id'
import { Browser, launch, Page } from 'puppeteer'
import { literal, Op } from 'sequelize'

/**
 * 皇冠首页地址
 */
const PAGE_URL = 'https://mos011.com/'
/**
 * 设备号
 */
const MACHINE_ID = machineIdSync()

let browser = undefined as unknown as Browser
let mainPage = undefined as unknown as Page
let accountTimer = undefined as unknown as NodeJS.Timeout
let account = undefined as unknown as CrownAccount
let lastActiveTime = 0

let activeInterval = 900000
export function setActiveInterval(interval: number) {
    activeInterval = interval
}

/**
 * 等待页面的元素出现
 * @param page 页面对象
 * @param selector 元素选择器
 */
export async function waitForElement(page: Page, selector: string): Promise<void> {
    while (true) {
        try {
            const element = await page.waitForSelector(selector)
            if (element) return
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
 * 初始化浏览器环境
 */
export function init() {
    return singleton('init_crown', doInit)
}

/**
 * 初始化浏览器环境
 */
async function doInit() {
    while (true) {
        await reset()

        account = await getCrownAccount()
        console.log('使用皇冠账号', account.username)

        const args: string[] = ['--no-sandbox', '--disable-images', '--lang=zh-cn']

        browser = await launch({
            // headless: false,
            args,
        })

        const page = await browser.newPage()
        await page.goto(PAGE_URL)
        console.log('page navigated')

        //等待登录脚本完成
        await waitForElement(page, '#usr')
        console.log('login form ready')
        await page.locator('#usr').fill(account.username)
        await page.locator('#pwd').fill(account.password)
        // await page.locator('.check_remember.lab_radio').click()
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

        //检测账号已被封禁
        const userData = (await page.evaluate(`return top.userData`)) as string
        console.log('皇冠账号状态', account.username, userData)
        // if (enable !== 'Y') {
        //     //账号已被封禁，修改账号属性
        //     await CrownAccount.update(
        //         {
        //             status: 0,
        //         },
        //         {
        //             where: {
        //                 id: account.id,
        //             },
        //             returning: false,
        //         },
        //     )
        //     //发送通知
        //     await sendNotification(
        //         `**异常通知**\r\n皇冠账号 ${account.username} 已被封禁，请尽快处理。`,
        //     )
        //     continue
        // }

        mainPage = page
        break
    }

    console.log('home page ready')
    lastActiveTime = Date.now()
}

/**
 * 释放浏览器环境
 */
export async function reset() {
    if (browser) {
        await browser.close()
        mainPage = undefined as unknown as Page
        browser = undefined as unknown as Browser
    }
    await freeCrownAccount()
}

/**
 * 释放持有的皇冠账号
 */
async function freeCrownAccount() {
    if (accountTimer) {
        clearInterval(accountTimer)
        accountTimer = undefined as unknown as NodeJS.Timeout
    }
    if (account) {
        try {
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
        } catch (err) {
            console.error(err)
        }
        account = undefined as unknown as CrownAccount
    }
}

/**
 * 获取可用的皇冠账号
 */
async function getCrownAccount() {
    const acc = await db.transaction(async (transaction) => {
        //先尝试获取当前分配的账号
        let account = await CrownAccount.findOne({
            where: {
                use_by: MACHINE_ID,
                status: 1,
                use_expires: {
                    [Op.lte]: new Date(),
                },
            },
            transaction,
        })
        if (account) return account

        //尝试随机获取一个可用的账号
        account = await CrownAccount.findOne({
            where: {
                [Op.and]: [
                    { status: 1 },
                    {
                        [Op.or]: [{ use_by: '' }, { use_expires: { [Op.lt]: new Date() } }],
                    },
                ],
            },
            transaction,
            lock: transaction.LOCK.UPDATE,
            order: [literal('RANDOM()')],
        })

        if (account) {
            //如果找到了账号就更新一下信息
            account.use_by = MACHINE_ID
            account.use_expires = new Date(Date.now() + 300000)
            await account.save({ transaction })
        }

        return account
    })
    if (!acc) {
        throw new Error('没有可用的皇冠账号')
    }

    //每2分钟维持一下皇冠账号的持有者
    setInterval(async () => {
        if (!account) return
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
    }, 120000)

    return acc
}

/**
 * 等待浏览器环境准备完毕
 */
export async function ready() {
    if (!mainPage || Date.now() - lastActiveTime >= activeInterval) {
        await init()
    }
    return mainPage
}

/**
 * 负责解析XML数据的解析器
 */
export const xmlParser = new XMLParser({
    parseTagValue: false,
    processEntities: false,
    ignoreDeclaration: true,
    ignoreAttributes: false,
})

/**
 * 执行皇冠操作的队列
 */
export const crownQueue = new Queue(1)
