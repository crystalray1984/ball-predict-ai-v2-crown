import axios from 'axios'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sendNotification } from './common/luffa'

async function main() {
    await sendNotification(`**用户购买VIP通知**
用户id 47
类型 周卡
购买方式 波场
购买价格 120 USDT`)
}

main().finally(() => process.exit())
