#!/usr/bin/env bash
# Repo entrypoint → backend npm script (privileged Postgres bootstrap for application_role).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}/backend"
exec npm run bootstrap:application-role
