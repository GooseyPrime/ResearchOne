#!/bin/bash
# ResearchOne Runtime Setup Script
# Run on truvector-runtime (45.55.250.106)
# Prerequisites: Node 22, Python 3.12 already installed

set -e

APP_DIR="/opt/researchone"
APP_USER="researchone"

echo "=== ResearchOne Runtime Setup ==="

# Create app user
if ! id "${APP_USER}" &>/dev/null; then
  sudo useradd -m -s /bin/bash "${APP_USER}"
fi

# Create app directory
sudo mkdir -p "${APP_DIR}"
sudo chown "${APP_USER}:${APP_USER}" "${APP_DIR}"

# Install PM2 for process management
sudo npm install -g pm2

# Install Nginx for reverse proxy
sudo apt-get update -qq
sudo apt-get install -y nginx

# Nginx config
sudo tee /etc/nginx/sites-available/researchone > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    # Frontend static files
    location / {
        root /opt/researchone/frontend/dist;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

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
    }

    # Atlas export files
    location /exports/ {
        alias /opt/researchone/backend/exports/;
        add_header Content-Disposition "attachment";
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/researchone /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "=== Nginx configured ==="
echo "=== Runtime setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy .env to /opt/researchone/backend/.env with your credentials"
echo "  2. Run: cd /opt/researchone/backend && npm run migrate"
echo "  3. Run: pm2 start ecosystem.config.js"
