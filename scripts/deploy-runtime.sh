#!/usr/bin/env bash
# Idempotent Emma VM deploy: git sync, build, migrate, PM2 from ecosystem.config.js.
# Run from repo checkout at DEPLOY_ROOT (default /opt/researchone).
#
# Required on VM: real git clone, backend/.env, Node, npm, pm2, python3 (smoke test).
#
# Usage:
#   cd /opt/researchone && ./scripts/deploy-runtime.sh
# Optional env:
#   RESEARCHONE_DEPLOY_ROOT   (default /opt/researchone)
#   RESEARCHONE_GIT_REF       (default origin/main)
#   DEPLOY_SOURCE             (e.g. github-actions — recorded in build-meta.json)
#   SKIP_PREFLIGHT            (set to 1 to skip preflight-runtime.sh)
#   DATABASE_ADMIN_URL_B64    (optional; base64 of DATABASE_ADMIN_URL — decoded at start; never logged)
#   REASSIGN_LEGACY_RESEARCH_OWNER (optional; set to 1 for one-shot mass-assign — see assignLegacyResearchOwnership.ts)
#   LEGACY_OWNER_USER_ID / LEGACY_OWNER_EMAIL (optional; Clerk user id or users.email lookup)

set -euo pipefail

DEPLOY_ROOT="${RESEARCHONE_DEPLOY_ROOT:-/opt/researchone}"
GIT_REF="${RESEARCHONE_GIT_REF:-origin/main}"
export DEPLOY_ROOT

# Optional: GitHub Actions passes DATABASE_ADMIN_URL_B64 (privileged URL). Decode into a
# deploy-local variable only — never export DATABASE_ADMIN_URL in this shell: PM2
# `startOrReload … --update-env` inherits the deploy environment and could persist a
# bootstrap-only secret into the API process (Codex/Copilot PR #110 review).
_RO_DATABASE_ADMIN_URL_FROM_B64=""
if [[ -n "${DATABASE_ADMIN_URL_B64:-}" ]]; then
  if ! command -v base64 >/dev/null 2>&1; then
    echo "[deploy] ERROR: base64 is required to decode DATABASE_ADMIN_URL_B64" >&2
    exit 1
  fi
  _RO_DATABASE_ADMIN_URL_FROM_B64="$(printf '%s' "${DATABASE_ADMIN_URL_B64}" | base64 -d)" || {
    echo "[deploy] ERROR: failed to decode DATABASE_ADMIN_URL_B64 (invalid base64?)" >&2
    exit 1
  }
  unset DATABASE_ADMIN_URL_B64
fi

echo "[deploy] ResearchOne runtime deploy starting"
echo "[deploy] DEPLOY_ROOT=${DEPLOY_ROOT} GIT_REF=${GIT_REF}"

cd "${DEPLOY_ROOT}"

if [[ "${SKIP_PREFLIGHT:-0}" != "1" ]]; then
  if [[ -x "${DEPLOY_ROOT}/scripts/preflight-runtime.sh" ]]; then
    RESEARCHONE_DEPLOY_ROOT="${DEPLOY_ROOT}" RESEARCHONE_GIT_REF="${GIT_REF}" \
      "${DEPLOY_ROOT}/scripts/preflight-runtime.sh"
  else
    echo "[deploy] WARNING: preflight script missing; running inline checks"
    [[ -d "${DEPLOY_ROOT}/.git" ]] || { echo "[deploy] ERROR: not a git clone" >&2; exit 1; }
    git remote get-url origin >/dev/null
    [[ -f "${DEPLOY_ROOT}/backend/.env" ]] || { echo "[deploy] ERROR: missing backend/.env" >&2; exit 1; }
  fi
else
  [[ -f "${DEPLOY_ROOT}/backend/.env" ]] || { echo "[deploy] ERROR: missing backend/.env" >&2; exit 1; }
fi

echo "[deploy] git fetch + reset ${GIT_REF}"
git fetch origin --prune
git reset --hard "${GIT_REF}"

echo "[deploy] ensure directories: backend/logs, exports"
mkdir -p "${DEPLOY_ROOT}/backend/logs" "${DEPLOY_ROOT}/exports"

echo "[deploy] backend: npm ci"
(
  cd "${DEPLOY_ROOT}/backend"
  npm ci
)

echo "[deploy] backend: npm run build"
(
  cd "${DEPLOY_ROOT}/backend"
  npm run build
)

GIT_SHA="$(git -C "${DEPLOY_ROOT}" rev-parse HEAD)"
BUILT_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
META_PATH="${DEPLOY_ROOT}/backend/dist/build-meta.json"
export GIT_SHA BUILT_AT META_PATH DEPLOY_SOURCE

node <<'NODE'
const fs = require('fs');
const o = {
  gitSha: process.env.GIT_SHA,
  builtAt: process.env.BUILT_AT,
};
if (process.env.DEPLOY_SOURCE && process.env.DEPLOY_SOURCE.trim()) {
  o.deployedBy = process.env.DEPLOY_SOURCE.trim();
}
fs.writeFileSync(process.env.META_PATH, JSON.stringify(o, null, 2) + '\n', 'utf8');
NODE

echo "[deploy] npm run migrate"
(
  cd "${DEPLOY_ROOT}/backend"
  npm run migrate
)

echo "[deploy] npm run bootstrap:application-role (RLS role + grants; fails closed if role missing and DATABASE_ADMIN_URL unset)"
if [[ -n "${_RO_DATABASE_ADMIN_URL_FROM_B64}" ]]; then
  (
    cd "${DEPLOY_ROOT}/backend"
    DATABASE_ADMIN_URL="${_RO_DATABASE_ADMIN_URL_FROM_B64}" npm run bootstrap:application-role
  )
else
  (
    cd "${DEPLOY_ROOT}/backend"
    npm run bootstrap:application-role
  )
fi
unset _RO_DATABASE_ADMIN_URL_FROM_B64
unset DATABASE_ADMIN_URL || true

echo "[deploy] backfill user scopes (idempotent)"
(
  cd "${DEPLOY_ROOT}/backend"
  npx tsx src/scripts/backfillUserScopes.ts
)

if [[ "${REASSIGN_LEGACY_RESEARCH_OWNER:-}" == "1" ]]; then
  echo "[deploy] one-shot legacy research ownership reassignment (REASSIGN_LEGACY_RESEARCH_OWNER=1)"
  (
    cd "${DEPLOY_ROOT}/backend"
    export REASSIGN_LEGACY_RESEARCH_OWNER=1
    export LEGACY_OWNER_USER_ID="${LEGACY_OWNER_USER_ID:-}"
    export LEGACY_OWNER_EMAIL="${LEGACY_OWNER_EMAIL:-}"
    export LEGACY_RESEARCH_ASSIGN_SCOPE="${LEGACY_RESEARCH_ASSIGN_SCOPE:-all_existing}"
    npx tsx src/scripts/assignLegacyResearchOwnership.ts
  )
else
  echo "[deploy] skipping legacy research ownership reassignment (set REASSIGN_LEGACY_RESEARCH_OWNER=1 to run once)"
fi

echo "[deploy] nginx: sync upload body limit (client_max_body_size)"
NGINX_SYNC="${DEPLOY_ROOT}/scripts/sync-nginx-api-site.sh"
if [[ ! -f "${NGINX_SYNC}" ]]; then
  echo "[deploy] ERROR: missing ${NGINX_SYNC}" >&2
  exit 1
fi
bash "${NGINX_SYNC}"
if command -v nginx >/dev/null 2>&1; then
  if ! grep -q 'client_max_body_size 64m' /etc/nginx/sites-available/researchone 2>/dev/null; then
    echo "[deploy] ERROR: nginx site missing client_max_body_size 64m after sync" >&2
    exit 1
  fi
fi

echo "[deploy] PM2 reconcile and start/reload"
PM2_CHECK="$(DEPLOY_ROOT="${DEPLOY_ROOT}" node <<'NODE'
const { execSync } = require('child_process');
const path = require('path');
const root = path.resolve(process.env.DEPLOY_ROOT);
let list;
try {
  list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
} catch {
  process.stdout.write('error\n');
  process.exit(0);
}
const app = list.find((a) => a.name === 'researchone-api');
if (!app) {
  process.stdout.write('missing\n');
  process.exit(0);
}
const env = app.pm2_env || {};
const cwd = path.resolve(env.pm_cwd || '');
const script = path.resolve(env.pm_exec_path || '');
const outLog = path.resolve(env.pm_out_log_path || env.out_file || '');
const errLog = path.resolve(env.pm_err_log_path || env.error_file || '');
const wantCwd = root;
const wantScript = path.join(root, 'backend', 'dist', 'index.js');
const wantOut = path.join(root, 'backend', 'logs', 'pm2-out.log');
const wantErr = path.join(root, 'backend', 'logs', 'pm2-error.log');
const ok =
  cwd === wantCwd &&
  script === wantScript &&
  outLog === wantOut &&
  errLog === wantErr;
process.stdout.write(ok ? 'ok\n' : 'bad\n');
process.exit(0);
NODE
)"

if [[ "${PM2_CHECK}" == "error" ]]; then
  echo "[deploy] ERROR: pm2 jlist failed" >&2
  exit 1
fi

if [[ "${PM2_CHECK}" == "missing" ]]; then
  echo "[deploy] PM2: app not registered; starting"
  pm2 start "${DEPLOY_ROOT}/ecosystem.config.js" --only researchone-api --update-env
elif [[ "${PM2_CHECK}" == "bad" ]]; then
  echo "[deploy] PM2: non-canonical process; deleting and starting fresh"
  pm2 delete researchone-api 2>/dev/null || true
  pm2 start "${DEPLOY_ROOT}/ecosystem.config.js" --only researchone-api --update-env
else
  echo "[deploy] PM2: canonical; startOrReload"
  pm2 startOrReload "${DEPLOY_ROOT}/ecosystem.config.js" --only researchone-api --update-env
fi

pm2 save || true

echo "[deploy] smoke test: GET http://127.0.0.1:3001/api/health (HTTP 200 + payload status not down)"
HEALTH_JSON=""
HEALTH_HTTP_CODE=""
HEALTH_TMP="${DEPLOY_ROOT}/.health-deploy-smoke.json"
for _ in {1..90}; do
  code="000"
  code=$(curl -sS --max-time 5 -o "${HEALTH_TMP}" -w '%{http_code}' "http://127.0.0.1:3001/api/health" 2>/dev/null || echo "000")
  if [[ -n "${code}" && "${code}" != "000" && -s "${HEALTH_TMP}" ]]; then
    HEALTH_HTTP_CODE="${code}"
    HEALTH_JSON="$(cat "${HEALTH_TMP}")"
    export HEALTH_JSON HEALTH_HTTP_CODE
    rm -f "${HEALTH_TMP}"
    break
  fi
  sleep 1
done
rm -f "${HEALTH_TMP}"
if [[ -z "${HEALTH_JSON}" ]]; then
  echo "[deploy] ERROR: could not GET /api/health from 127.0.0.1:3001 after PM2 start (waited ~90s; connection refused, timeout, or empty body)" >&2
  exit 1
fi

python3 <<'PY'
import json, os, sys
raw = os.environ.get("HEALTH_JSON", "")
http_code = os.environ.get("HEALTH_HTTP_CODE", "")
if http_code != "200":
    print(f"[deploy] ERROR: /api/health must return HTTP 200 when ready (got {http_code})", file=sys.stderr)
    sys.exit(1)
try:
    data = json.loads(raw)
except json.JSONDecodeError as e:
    print("[deploy] ERROR: health response is not JSON:", e, file=sys.stderr)
    sys.exit(1)
for key in ("status", "timestamp"):
    if key not in data:
        print(f"[deploy] ERROR: health missing key: {key}", file=sys.stderr)
        sys.exit(1)
detail_keys = ("service", "version", "gitSha", "nodeEnv")
present_detail_keys = [key for key in detail_keys if key in data]
if present_detail_keys and len(present_detail_keys) != len(detail_keys):
    missing = [key for key in detail_keys if key not in data]
    print(
        "[deploy] ERROR: health returned a partial detailed payload; missing keys:",
        ", ".join(missing),
        file=sys.stderr,
    )
    sys.exit(1)
for bad in ("envFile", "env_file"):
    if bad in data:
        print("[deploy] ERROR: health must not expose env file path", file=sys.stderr)
        sys.exit(1)
if data.get("status") == "down":
    print("[deploy] ERROR: health payload status=down (core checks failed — do not ship this deploy)", file=sys.stderr)
    print(json.dumps(data.get("checks", {}), indent=2)[:8000], file=sys.stderr)
    sys.exit(1)
print(
    "[deploy] smoke OK:",
    data.get("service", "public-health"),
    data.get("version", "n/a"),
    data.get("gitSha", "n/a"),
    data.get("nodeEnv", "n/a"),
    "payload_status=" + str(data.get("status")),
)
PY

echo "[deploy] done"
