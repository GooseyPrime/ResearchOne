#!/bin/bash
# ResearchOne Runtime Setup Script
# Run on Emma runtime VM (truvector-runtime)
# Prerequisites: Node 22, Python 3.12 already installed
#
# Deployment mode: RECOMMENDED — Vercel frontend + Emma backend
# The frontend is hosted on Vercel. This script sets up the backend API only.
# Do NOT copy frontend build output to this VM in split mode.

set -e

APP_DIR="/opt/researchone"
EXPORTS_DIR="/opt/researchone/exports"
APP_USER="researchone"

echo "=== ResearchOne Runtime Setup (Backend only — Vercel split mode) ==="

# Create app user
if ! id "${APP_USER}" &>/dev/null; then
  sudo useradd -m -s /bin/bash "${APP_USER}"
fi

# Create app and exports directories
sudo mkdir -p "${APP_DIR}"
sudo mkdir -p "${EXPORTS_DIR}"
sudo chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

# Install PM2 for process management
sudo npm install -g pm2

# Install Nginx for reverse proxy
sudo apt-get update -qq
sudo apt-get install -y nginx

# Nginx config — split deployment mode
# Frontend is on Vercel. This nginx only serves /api, /socket.io, and /exports.
sudo tee /etc/nginx/sites-available/researchone > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    # API backend proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # WebSocket proxy
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Atlas export files — canonical path must match EXPORTS_DIR in backend config
    location /exports/ {
        alias /opt/researchone/exports/;
        add_header Content-Disposition "attachment";
        add_header Access-Control-Allow-Origin "*";
    }

    # Health endpoint passthrough
    location /health {
        proxy_pass http://127.0.0.1:3001/api/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/researchone /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "=== Nginx configured (API + exports only — frontend on Vercel) ==="
echo "=== Runtime setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy backend to ${APP_DIR}/backend"
echo "  2. Copy .env to ${APP_DIR}/backend/.env with your credentials"
echo "     Required backend env vars:"
echo "       NODE_ENV, PORT, DATABASE_URL, REDIS_URL, REDIS_PASSWORD (if set),"
echo "       OPENROUTER_API_KEY, JWT_SECRET, CORS_ORIGINS"
echo "       EXPORTS_DIR=/opt/researchone/exports"
echo "  3. Run: cd ${APP_DIR}/backend && npm install && npm run migrate"
echo "  4. Run: pm2 start ecosystem.config.js"
echo ""
echo "Vercel frontend env vars to set in Vercel dashboard:"
echo "  VITE_API_BASE_URL=https://<this-vm-domain-or-ip>"
echo "  VITE_SOCKET_URL=https://<this-vm-domain-or-ip>"
echo "  VITE_EXPORTS_BASE_URL=https://<this-vm-domain-or-ip>"
echo ""
echo "DO NOT set OPENROUTER_API_KEY, JWT_SECRET, DATABASE_URL, or REDIS_PASSWORD in Vercel."

