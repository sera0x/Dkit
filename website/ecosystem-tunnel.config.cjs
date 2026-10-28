module.exports = {
  apps: [{
    name: 'dkit-tunnel',
    script: 'cloudflared',
    args: 'tunnel run my-website-tunnel',
    cwd: '/home/MJ/d-kit/website',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    error: '/home/MJ/.pm2/logs/dkit-tunnel-error.log',
    out: '/home/MJ/.pm2/logs/dkit-tunnel-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
};