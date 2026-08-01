#!/usr/bin/env bash
# Sync Emma nginx site config from the repo and reload nginx.
# Safe to run on every deploy (idempotent).
#
# The repository config (scripts/nginx/researchone-api-site.conf) requires TLS
# certificates issued by Certbot for:
#   api.researchone.io  research-api.intellmeai.com
# Certificate name: research-api.intellmeai.com
#
# If the required certificate files are absent on the target host, this script
# fails with a clear error rather than silently deploying an HTTP-only config.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_CONF="${REPO_ROOT}/scripts/nginx/researchone-api-site.conf"
TARGET_AVAILABLE="/etc/nginx/sites-available/researchone"
TARGET_ENABLED="/etc/nginx/sites-enabled/researchone"

# Required Let's Encrypt resources for the production TLS configuration.
CERT_DIR="/etc/letsencrypt/live/research-api.intellmeai.com"
REQUIRED_TLS_FILES=(
  "${CERT_DIR}/fullchain.pem"
  "${CERT_DIR}/privkey.pem"
  "/etc/letsencrypt/options-ssl-nginx.conf"
  "/etc/letsencrypt/ssl-dhparams.pem"
)

if [[ ! -f "${SOURCE_CONF}" ]]; then
  echo "[nginx] ERROR: missing ${SOURCE_CONF}" >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "[nginx] nginx not installed — skip sync (non-Emma host?)"
  exit 0
fi

# Validate that all Certbot TLS resources exist before overwriting the live
# nginx config.  A missing certificate is a deployment configuration error;
# do NOT fall back silently to HTTP-only service.
echo "[nginx] checking required TLS certificate files"
TLS_MISSING=0
for f in "${REQUIRED_TLS_FILES[@]}"; do
  if ! sudo test -f "${f}"; then
    echo "[nginx] ERROR: required TLS file missing: ${f}" >&2
    TLS_MISSING=1
  fi
done
if [[ "${TLS_MISSING}" -ne 0 ]]; then
  echo "[nginx] ERROR: one or more Let's Encrypt certificate files are missing." >&2
  echo "[nginx]        Run: sudo certbot certonly --nginx -d api.researchone.io -d research-api.intellmeai.com" >&2
  echo "[nginx]        Then re-run this script." >&2
  exit 1
fi

echo "[nginx] installing ${TARGET_AVAILABLE}"
sudo cp "${SOURCE_CONF}" "${TARGET_AVAILABLE}"
sudo ln -sf "${TARGET_AVAILABLE}" "${TARGET_ENABLED}"
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
sudo nginx -t
sudo systemctl reload nginx
echo "[nginx] reloaded (TLS enabled; client_max_body_size must allow MAX_FILE_SIZE_MB uploads)"
