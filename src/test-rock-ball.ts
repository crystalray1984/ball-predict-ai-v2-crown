import { getCrownData, init, reset, setActiveInterval } from '@/crown'
import { delay } from './common/helpers'

async function main() {
    await init()

    //读取皇冠的盘口
    while (true) {
        const data = await getCrownData('10122794', 'live')
        console.log(data)
        await delay(30000)
    }
}

main()
