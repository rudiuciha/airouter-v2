module.exports = {
  apps: [{
    name: 'airouter',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production' },
    error_file: './data/pm2-err.log',
    out_file:   './data/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
