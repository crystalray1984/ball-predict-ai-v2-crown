import { connect } from 'amqplib'

async function main() {
    //创建连接
    const connection = await connect({
        hostname: '154.89.0.29',
        username: 'admin',
        password: 'mxJMHCOCynYS14lGtqzZ',
    })

    //创建通道
    const channel = await connection.createChannel()

    //创建队列
    await channel.assertQueue('test_queue')

    //创建交换机
    await channel.assertExchange('test_queue', 'x-delayed-message', {
        arguments: {
            'x-delayed-type': 'direct',
        },
    })

    //绑定交换机和队列
    await channel.bindQueue('test_queue', 'test_queue', '', {
        'x-delayed-type': 'direct',
    })

    //关闭通道
    await channel.close()

    //关闭连接
    await connection.close()
}

main()
