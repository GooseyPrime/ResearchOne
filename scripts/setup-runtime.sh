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

# Nginx config — split deployment mode (see scripts/nginx/researchone-api-site.conf)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "${SCRIPT_DIR}/sync-nginx-api-site.sh"

echo "=== Nginx configured (API + exports only — frontend on Vercel) ==="
echo "=== Runtime setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Clone this repository to ${APP_DIR} (git clone …) so deploy can reset to origin/main."
echo "  2. Copy backend/.env.production.example to ${APP_DIR}/backend/.env and edit secrets."
echo "     Required backend env vars:"
echo "       NODE_ENV, PORT, DATABASE_URL, REDIS_URL, REDIS_PASSWORD (if set),"
echo "       OPENROUTER_API_KEY, JWT_SECRET, CORS_ORIGINS"
echo "       EXPORTS_DIR=${EXPORTS_DIR}"
echo "  3. From repo root ${APP_DIR} (NOT from backend/):"
echo "       ./scripts/deploy-runtime.sh"
echo "     PM2 must use ecosystem.config.js from ${APP_DIR}; cwd in that file is ${APP_DIR}."
echo ""
echo "Vercel frontend env vars (origin only — no /api path; use http:// if you have no TLS yet):"
echo "  VITE_API_BASE_URL=http://<this-vm-host-or-ip>"
echo "  VITE_SOCKET_URL=http://<this-vm-host-or-ip>"
echo "  VITE_EXPORTS_BASE_URL=http://<this-vm-host-or-ip>"
echo ""
echo "DO NOT set OPENROUTER_API_KEY, JWT_SECRET, DATABASE_URL, or REDIS_PASSWORD in Vercel."
