import axios from 'axios'

async function main() {
    const resp = await axios.request({
        url: 'https://livestatic.titan007.com/vbsxml/bfdata_ut.js',
        params: {
            r: `007${Date.now()}`,
        },
        headers: {
            Referer: 'https://live.titan007.com/oldIndexall.aspx',
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0',
        },
        responseType: 'text',
    })

    console.log(resp.data)
}

main().finally(() => process.exit())
