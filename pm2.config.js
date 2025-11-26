function createConfig(name, script, envs = {}) {
    return {
        name,
        script: script ?? `./dist/start-${name}.js`,
        interpreter_args: '-r tsconfig-paths/register',
        env: {
            ...envs,
            NODE_ENV: 'production',
            TZ: 'Asia/Shanghai',
            TS_NODE_BASEURL: './dist',
        },
        log_date_format: 'YYYY-MM-DDTHH:mm:ss',
        merge_logs: true,
        error_file: `./runtime/logs/${name}.log`,
        out_file: `./runtime/logs/${name}.log`,
        pid_file: `./runtime/${name}.pid`,
    }
}

module.exports = {
    'crown-matches': createConfig('crown-matches'),
    'crown-matches-data': createConfig('crown-matches-data'),
    'crown-robot': createConfig('crown-robot'),
    'ready-check': createConfig('ready-check'),
    surebet: createConfig('surebet'),
    'surebet-check': createConfig('surebet-check'),
    titan007: createConfig('titan007'),
    'luffa-robot': createConfig('luffa-robot'),
    'luffa-message': createConfig('luffa-message'),
    'v3-check': createConfig('v3-check'),
    'rockball-check': createConfig('rockball-check'),
    createConfig,
}
