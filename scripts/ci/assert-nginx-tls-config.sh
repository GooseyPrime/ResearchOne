#!/usr/bin/env bash
# Assert that the production Nginx config template contains all required TLS
# directives.  Fails if the config has regressed to HTTP-only (server_name _;
# listen 80; without TLS).
#
# Usage: bash scripts/ci/assert-nginx-tls-config.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${SCRIPT_DIR}/../nginx/researchone-api-site.conf"

if [[ ! -f "${CONF}" ]]; then
  echo "[assert-nginx] ERROR: config file not found: ${CONF}" >&2
  exit 1
fi

FAIL=0

check() {
  local description="$1"
  local pattern="$2"
  if grep -qE "${pattern}" "${CONF}"; then
    echo "[assert-nginx] OK: ${description}"
  else
    echo "[assert-nginx] FAIL: ${description} (pattern: ${pattern})" >&2
    FAIL=1
  fi
}

# TLS listener
check "listen 443 ssl"                          "listen[[:space:]]+443[[:space:]]+ssl"
# Both production domains explicit (not wildcard _)
check "server_name includes api.researchone.io" "server_name[^;]*api\.researchone\.io"
check "server_name includes research-api.intellmeai.com" "server_name[^;]*research-api\.intellmeai\.com"
# Certificate references
check "ssl_certificate directive"               "ssl_certificate[[:space:]]"
check "ssl_certificate_key directive"           "ssl_certificate_key[[:space:]]"
# HTTP listener (redirect block)
check "listen 80 block"                         "listen[[:space:]]+80"
# Default server for port 80 to prevent open-redirect on unknown Host headers
check "default_server reject block on port 80"  "listen[[:space:]]+80[[:space:]]+default_server"
# HTTP→HTTPS redirect
check "HTTPS redirect (return 301 https)"       "return[[:space:]]+301[[:space:]]+https://"
# Upload body limit
check "client_max_body_size 64m"                "client_max_body_size[[:space:]]+64m"
# Proxy target
check "proxy_pass to 127.0.0.1:3001"           "proxy_pass[[:space:]]+http://127\.0\.0\.1:3001"
# Required locations
check "/socket.io/ location"                    "location[[:space:]]*/socket\.io/"
check "/exports/ location"                      "location[[:space:]]*/exports/"
check "/health location"                        "location[[:space:]]*/health"
# Must NOT use catch-all server_name _
if grep -qE "server_name[[:space:]]+_;" "${CONF}"; then
  echo "[assert-nginx] FAIL: config uses 'server_name _;' (catch-all) — production virtual host must list explicit domain names" >&2
  FAIL=1
else
  echo "[assert-nginx] OK: no catch-all 'server_name _;'"
fi

if [[ "${FAIL}" -ne 0 ]]; then
  echo ""
  echo "[assert-nginx] One or more assertions failed. Fix scripts/nginx/researchone-api-site.conf." >&2
  exit 1
fi

echo ""
echo "[assert-nginx] All assertions passed."
