#!/usr/bin/env bash
# Fail if Vitest/Jest mock APIs appear outside test-only paths.
# Production bundles must not ship mock harness calls; unit tests may use
# mocks only under __tests__/** or in *.test.* / *.spec.* files.
#
# Usage: from repo root — bash scripts/ci/assert-no-test-mocks-in-app-src.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! command -v rg >/dev/null 2>&1; then
  echo "::error::This script requires ripgrep (rg). Install ripgrep or use a runner image that includes it."
  exit 1
fi

# Match common Vitest/Jest mock entry points (not plain English "mock" in comments).
PATTERN='vi\.(mock|fn|importActual|hoisted|spyOn|stub)|jest\.(mock|fn|spyOn)'

GLOBS=(
  '--glob'
  '!**/__tests__/**'
  '--glob'
  '!**/*.test.ts'
  '--glob'
  '!**/*.test.tsx'
  '--glob'
  '!**/*.spec.ts'
  '--glob'
  '!**/*.spec.tsx'
  '--glob'
  '!**/e2e/**'
)

scan_tree () {
  local label="$1"
  local dir="$2"
  if [[ ! -d "$dir" ]]; then
    return 0
  fi
  local hits
  hits="$(rg --line-number "${GLOBS[@]}" "$PATTERN" "$dir" 2>/dev/null || true)"
  if [[ -n "${hits}" ]]; then
    echo "::error::Test mock APIs (${PATTERN}) found in ${label} application source (outside __tests__ and *.test.* / *.spec.*):"
    echo "${hits}"
    exit 1
  fi
}

scan_tree "backend" "backend/src"
scan_tree "frontend" "frontend/src"

echo "OK: no Vitest/Jest mock APIs in backend/src or frontend/src application trees."
