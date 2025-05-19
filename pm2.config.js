const env = {
    NODE_ENV: 'production',
    TZ: 'Asia/Shanghai',
    TS_NODE_BASEURL: './dist',
}

function createConfig(name, script) {
    return {
        name,
        script: script ?? `./dist/start-${name}.js`,
        interpreter_args: '-r tsconfig-paths/register',
        env: {
            NODE_ENV: 'production',
            TZ: 'Asia/Shanghai',
            TS_NODE_BASEURL: './dist',
        },
        merge_logs: true,
        error_file: `./runtime/logs/${name}.log`,
        out_file: `./runtime/logs/${name}.log`,
        pid_file: `./runtime/${name}.pid`,
    }
}

module.exports = {
    apps: [
        createConfig('crown-matches'),
        createConfig('crown-robot'),
        createConfig('final-check'),
        createConfig('ready-check'),
        createConfig('surebet'),
        createConfig('titan007'),
    ],
}
