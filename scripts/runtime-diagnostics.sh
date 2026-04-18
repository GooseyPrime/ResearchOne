#!/usr/bin/env bash
# Print non-secret runtime diagnostics (VM troubleshooting).
# Usage: RESEARCHONE_DEPLOY_ROOT=/opt/researchone ./scripts/runtime-diagnostics.sh

set -euo pipefail

DEPLOY_ROOT="${RESEARCHONE_DEPLOY_ROOT:-/opt/researchone}"

echo "=== ResearchOne runtime diagnostics ==="
echo "DEPLOY_ROOT=${DEPLOY_ROOT}"
echo "PWD=$(pwd)"
echo

if [[ -d "${DEPLOY_ROOT}/.git" ]]; then
  echo "git HEAD: $(git -C "${DEPLOY_ROOT}" rev-parse HEAD 2>/dev/null || echo '?')"
  echo "git branch: $(git -C "${DEPLOY_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
else
  echo "git: not a clone (no .git)"
fi
echo

echo "Expected runtime env file (not contents): ${DEPLOY_ROOT}/backend/.env"
if [[ -f "${DEPLOY_ROOT}/backend/.env" ]]; then
  echo "  status: present"
  ls -la "${DEPLOY_ROOT}/backend/.env"
else
  echo "  status: MISSING"
fi
echo

DIST_MAIN="${DEPLOY_ROOT}/backend/dist/index.js"
if [[ -f "${DIST_MAIN}" ]]; then
  echo "backend/dist/index.js:"
  ls -la "${DIST_MAIN}"
else
  echo "backend/dist/index.js: MISSING"
fi
echo

META="${DEPLOY_ROOT}/backend/dist/build-meta.json"
if [[ -f "${META}" ]]; then
  echo "build-meta.json:"
  cat "${META}"
  echo
else
  echo "build-meta.json: not present"
  echo
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "pm2 describe researchone-api:"
  pm2 describe researchone-api 2>/dev/null || echo "(process not found)"
else
  echo "pm2: not installed"
fi
echo

echo "backend/logs (PM2 + app logs):"
ls -la "${DEPLOY_ROOT}/backend/logs" 2>/dev/null || echo "(directory missing)"
echo

echo "exports dir (canonical): ${DEPLOY_ROOT}/exports"
ls -la "${DEPLOY_ROOT}/exports" 2>/dev/null || echo "(directory missing)"
echo "=== end diagnostics ==="
