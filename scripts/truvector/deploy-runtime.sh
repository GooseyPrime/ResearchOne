#!/usr/bin/env bash
# Idempotent Emma VM deploy for TruVector Core.
# Modelled on ResearchOne scripts/deploy-runtime.sh.
# Run from repo checkout at DEPLOY_ROOT (default /opt/truvector).
#
# TruVector differences from ResearchOne:
#   - No migration runner: PgVectorStoreAdapter creates its pgvector table at boot.
#   - App name: truvector-api (PM2), port 3000.
#   - Redis DB 1 (ResearchOne holds DB 0).
#   - Deploy root: /opt/truvector.
#
# Required on VM: real git clone, .env, Node, npm, pm2, python3, pg_dump (backups).
#
# Usage:
#   cd /opt/truvector && ./scripts/deploy-runtime.sh
# Optional env:
#   TRUVECTOR_DEPLOY_ROOT   (default /opt/truvector)
#   TRUVECTOR_GIT_REF       (default origin/main)
#   DEPLOY_SOURCE           (e.g. github-actions — recorded in build-meta.json)

set -euo pipefail

DEPLOY_ROOT="${TRUVECTOR_DEPLOY_ROOT:-/opt/truvector}"
GIT_REF="${TRUVECTOR_GIT_REF:-origin/main}"

echo "[deploy] TruVector Core runtime deploy starting"
echo "[deploy] DEPLOY_ROOT=${DEPLOY_ROOT} GIT_REF=${GIT_REF}"

cd "${DEPLOY_ROOT}"

# ── Pre-flight ─────────────────────────────────────────────────────────────
[[ -d "${DEPLOY_ROOT}/.git" ]] || { echo "[deploy] ERROR: not a git clone" >&2; exit 1; }
[[ -f "${DEPLOY_ROOT}/.env" ]] || { echo "[deploy] ERROR: missing .env" >&2; exit 1; }
command -v node >/dev/null || { echo "[deploy] ERROR: node not found" >&2; exit 1; }
command -v pm2 >/dev/null  || { echo "[deploy] ERROR: pm2 not found" >&2; exit 1; }

# ── Git sync ────────────────────────────────────────────────────────────────
echo "[deploy] git fetch + reset ${GIT_REF}"
git fetch origin
git reset --hard "${GIT_REF}"

# ── Build ───────────────────────────────────────────────────────────────────
echo "[deploy] npm ci + build"
npm ci --omit=dev
npm run build

# ── Logs dir ────────────────────────────────────────────────────────────────
mkdir -p "${DEPLOY_ROOT}/logs"

# ── PM2 start/reload ────────────────────────────────────────────────────────
# TruVector's pgvector table is created by PgVectorStoreAdapter at boot —
# no migration runner needed.
echo "[deploy] pm2 startOrReload"
pm2 startOrReload "${DEPLOY_ROOT}/ecosystem.config.js" \
  --update-env \
  --env production

# ── Build metadata ──────────────────────────────────────────────────────────
GIT_SHA="$(git rev-parse HEAD)"
echo "[deploy] recording build-meta.json"
cat > "${DEPLOY_ROOT}/build-meta.json" <<JSON
{
  "gitSha": "${GIT_SHA}",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deploySource": "${DEPLOY_SOURCE:-manual}",
  "gitRef": "${GIT_REF}"
}
JSON

# ── Health smoke test ───────────────────────────────────────────────────────
echo "[deploy] waiting for API on :3000"
HEALTH_JSON=""
HEALTH_HTTP_CODE=""
for i in $(seq 1 90); do
  HEALTH_TMP="$(mktemp)"
  code="$(curl -s -o "${HEALTH_TMP}" -w "%{http_code}" --max-time 3 http://127.0.0.1:3000/health 2>/dev/null || true)"
  if [[ -n "${code}" && "${code}" != "000" && -s "${HEALTH_TMP}" ]]; then
    HEALTH_HTTP_CODE="${code}"
    HEALTH_JSON="$(cat "${HEALTH_TMP}")"
    rm -f "${HEALTH_TMP}"
    break
  fi
  rm -f "${HEALTH_TMP}"
  sleep 1
done

if [[ -z "${HEALTH_JSON}" ]]; then
  echo "[deploy] ERROR: could not GET /health from 127.0.0.1:3000 after 90s" >&2
  exit 1
fi

HEALTH_JSON="${HEALTH_JSON}" HEALTH_HTTP_CODE="${HEALTH_HTTP_CODE}" python3 <<'PY'
import json, os, sys
raw = os.environ.get("HEALTH_JSON", "")
http_code = os.environ.get("HEALTH_HTTP_CODE", "")
if http_code != "200":
    print(f"[deploy] ERROR: /health must return HTTP 200 (got {http_code})", file=sys.stderr)
    sys.exit(1)
try:
    data = json.loads(raw)
except json.JSONDecodeError as e:
    print("[deploy] ERROR: health response is not JSON:", e, file=sys.stderr)
    sys.exit(1)
if data.get("status") == "down":
    print("[deploy] ERROR: health status=down — do not ship this deploy", file=sys.stderr)
    sys.exit(1)
print("[deploy] smoke OK:", json.dumps(data.get("status")))
PY

echo "[deploy] done"
