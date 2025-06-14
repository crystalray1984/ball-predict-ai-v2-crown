import { publish } from './common/rabbitmq'

async function main() {
    //推送到消息队列
    await publish(
        'send_luffa_message',
        JSON.stringify({
            uid: 'fysgcHNkS5w',
            is_group: false,
            msg: {
                text: '测试队列消息',
            },
        }),
    )
}

main().finally(() => process.exit())
