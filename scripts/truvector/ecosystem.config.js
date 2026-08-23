// TruVector Core PM2 ecosystem config.
// Place at repo root (/opt/truvector/ecosystem.config.js) on Emma.
// Modelled on ResearchOne ecosystem.config.js; port 3000 avoids collision with ResearchOne (3001).
//
// `cwd` is derived, not hardcoded. The deploy script honours
// TRUVECTOR_DEPLOY_ROOT / EMMA_DEPLOY_PATH, so a hardcoded /opt/truvector meant
// a non-default checkout was built in one place and started from another —
// running stale code, or failing outright, after a deploy that reported
// success (Codex, #224). __dirname resolves to wherever this file actually
// lives, which is by definition the root that was just deployed.
const deployRoot = process.env.TRUVECTOR_DEPLOY_ROOT || __dirname;

module.exports = {
  apps: [
    {
      name: 'truvector-api',
      script: './dist/index.js',
      cwd: deployRoot,
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
