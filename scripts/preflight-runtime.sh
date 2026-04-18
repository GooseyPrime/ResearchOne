#!/usr/bin/env bash
# Verify the Emma runtime checkout is a usable git clone before deploy.
# Usage: RESEARCHONE_DEPLOY_ROOT=/opt/researchone ./scripts/preflight-runtime.sh

set -euo pipefail

DEPLOY_ROOT="${RESEARCHONE_DEPLOY_ROOT:-/opt/researchone}"
GIT_REF="${RESEARCHONE_GIT_REF:-origin/main}"

echo "[preflight] deploy root: ${DEPLOY_ROOT}"

if [[ ! -d "${DEPLOY_ROOT}" ]]; then
  echo "[preflight] ERROR: directory does not exist: ${DEPLOY_ROOT}" >&2
  exit 1
fi

if [[ ! -d "${DEPLOY_ROOT}/.git" ]]; then
  echo "[preflight] ERROR: not a git checkout (missing ${DEPLOY_ROOT}/.git). Clone the repo on the VM." >&2
  exit 1
fi

if ! git -C "${DEPLOY_ROOT}" remote get-url origin >/dev/null 2>&1; then
  echo "[preflight] ERROR: git remote 'origin' is not configured." >&2
  exit 1
fi

echo "[preflight] origin: $(git -C "${DEPLOY_ROOT}" remote get-url origin)"

# Ensure we can resolve the deploy ref after a fetch (deploy script will fetch + reset)
if ! git -C "${DEPLOY_ROOT}" fetch origin --prune; then
  echo "[preflight] ERROR: git fetch origin failed." >&2
  exit 1
fi

if ! git -C "${DEPLOY_ROOT}" rev-parse --verify "${GIT_REF}" >/dev/null 2>&1; then
  echo "[preflight] ERROR: ref not found: ${GIT_REF} (after fetch). Set RESEARCHONE_GIT_REF if needed." >&2
  exit 1
fi

if [[ ! -f "${DEPLOY_ROOT}/backend/.env" ]]; then
  echo "[preflight] ERROR: missing ${DEPLOY_ROOT}/backend/.env (production runtime env file)." >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "[preflight] ERROR: node not found in PATH." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "[preflight] ERROR: npm not found in PATH." >&2; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "[preflight] ERROR: pm2 not found in PATH." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "[preflight] ERROR: python3 not found in PATH (required for deploy smoke test)." >&2; exit 1; }

echo "[preflight] OK"
