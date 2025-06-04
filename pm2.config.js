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
        log_date_format: 'YYYY-MM-DD HH:mm:ssZ',
        merge_logs: true,
        error_file: `./runtime/logs/${name}.log`,
        out_file: `./runtime/logs/${name}.log`,
        pid_file: `./runtime/${name}.pid`,
    }
}

module.exports = {
    'final-check': createConfig('final-check'),
    'ready-check': createConfig('ready-check'),
    surebet: createConfig('surebet'),
    titan007: createConfig('titan007'),
}
