// TruVector Core PM2 ecosystem config.
// Place at repo root (/opt/truvector/ecosystem.config.js) on Emma.
// Modelled on ResearchOne ecosystem.config.js; port 3000 avoids collision with ResearchOne (3001).
module.exports = {
  apps: [
    {
      name: 'truvector-api',
      script: './dist/index.js',
      cwd: '/opt/truvector',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_file: './.env',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
