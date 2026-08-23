# WO-AE-8: TruVector Core on Emma — Deploy Runbook

## Overview

TruVector Core (`truvector-core` repo) is application-ready. It builds to
`dist/index.js`, listens on **port 3000**, and shares Emma's Postgres and Redis
instances with ResearchOne (which holds port 3001 and Redis DB 0).

This directory contains all deploy artifacts modelled on ResearchOne. Copy them
into the `truvector-core` repo and follow the setup steps below.

---

## Files in this directory

| File | Destination in truvector-core | Purpose |
|------|-------------------------------|---------|
| `ecosystem.config.js` | repo root | PM2 process config (app: `truvector-api`, port 3000) |
| `deploy-runtime.sh` | `scripts/deploy-runtime.sh` | Idempotent VM deploy script |
| `truvector-api-site.conf` | — (install to nginx) | nginx reverse proxy config |
| `deploy-backend-emma.yml` | `.github/workflows/deploy-backend-emma.yml` | GitHub Actions deploy workflow |

---

## One-time Emma VM setup

### 1. Measure Emma hardware (do this first and record in the PR)

```bash
free -h; nproc; df -h /
pm2 list
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size(current_database()));"
sudo -u postgres psql -c "SHOW shared_buffers; SHOW effective_cache_size;"
redis-cli info memory | head -5
vmstat 1 5
```

Derived estimate: two Node APIs at ~1–1.5 GB each, ResearchOne's 98k×1536 float
vectors ≈ 604 MB + HNSW graph (1.5–2× again), second TruVector corpus, Redis,
OS headroom → **16 GB / 8 vCPU / 80–100 GB disk** recommended; 8 GB minimum.

### 2. Create the Postgres database

```bash
sudo -u postgres psql <<SQL
CREATE DATABASE truvector;
CREATE USER truvector_app WITH PASSWORD '<strong-password>';
GRANT ALL PRIVILEGES ON DATABASE truvector TO truvector_app;
\c truvector
CREATE EXTENSION IF NOT EXISTS vector;
SQL
```

### 3. Clone the repo to Emma

```bash
sudo mkdir -p /opt/truvector
sudo chown $USER /opt/truvector
git clone https://github.com/<owner>/truvector-core.git /opt/truvector
```

### 4. Create `.env`

```bash
cat > /opt/truvector/.env <<ENV
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://truvector_app:<password>@127.0.0.1:5432/truvector
REDIS_URL=redis://127.0.0.1:6379/1
# ... other TruVector env vars
ENV
```

Note: Redis DB **1** — ResearchOne holds DB 0. Keep them separate.

### 5. Install nginx config and obtain TLS certificate

```bash
sudo cp /opt/truvector/scripts/truvector-api-site.conf /etc/nginx/sites-available/truvector
sudo ln -sf /etc/nginx/sites-available/truvector /etc/nginx/sites-enabled/truvector
# Obtain certificate first:
sudo certbot --nginx -d api.truvector.io
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Create logs directory and run initial deploy

```bash
mkdir -p /opt/truvector/logs
cd /opt/truvector && bash scripts/deploy-runtime.sh
```

### 7. Add GitHub Actions secrets (same values as ResearchOne)

| Secret | Value |
|--------|-------|
| `EMMA_HOST` | Same VM IP/hostname as ResearchOne |
| `EMMA_USER` | Same SSH user |
| `EMMA_SSH_KEY` | Same private key |
| `EMMA_DEPLOY_PATH` | `/opt/truvector` |
| `EMMA_KNOWN_HOSTS` | Same known_hosts entry |
| `EMMA_PUBLIC_HEALTH_URL` | `https://api.truvector.io` |

---

## Ongoing deploy

Push to `main` triggers the GitHub Actions workflow automatically.
Manual deploy: `TRUVECTOR_DEPLOY_ROOT=/opt/truvector bash scripts/deploy-runtime.sh`
