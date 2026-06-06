#!/usr/bin/env bash
# Sync Emma nginx site config from the repo and reload nginx.
# Safe to run on every deploy (idempotent).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_CONF="${REPO_ROOT}/scripts/nginx/researchone-api-site.conf"
TARGET_AVAILABLE="/etc/nginx/sites-available/researchone"
TARGET_ENABLED="/etc/nginx/sites-enabled/researchone"

if [[ ! -f "${SOURCE_CONF}" ]]; then
  echo "[nginx] ERROR: missing ${SOURCE_CONF}" >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "[nginx] nginx not installed — skip sync (non-Emma host?)"
  exit 0
fi

echo "[nginx] installing ${TARGET_AVAILABLE}"
sudo cp "${SOURCE_CONF}" "${TARGET_AVAILABLE}"
sudo ln -sf "${TARGET_AVAILABLE}" "${TARGET_ENABLED}"
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
sudo nginx -t
sudo systemctl reload nginx
echo "[nginx] reloaded (client_max_body_size must allow MAX_FILE_SIZE_MB uploads)"
