module.exports = {
  apps: [{
    name: 'dkit-frontend',
    script: './start.sh',
    cwd: '/home/MJ/d-kit/website',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    error: '/home/MJ/.pm2/logs/dkit-frontend-error.log',
    out: '/home/MJ/.pm2/logs/dkit-frontend-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    env: {
      NODE_ENV: 'production'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};