import * as ai from '@/ai'

if (require.main === module) {
    //开启ai队列消费
    ai.rockball.consume()
}
