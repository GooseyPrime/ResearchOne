#!/usr/bin/env bash
# Fail if Vitest/Jest mock APIs appear outside test-only paths.
# Production bundles must not ship mock harness calls; unit tests may use
# mocks only under __tests__/** or in *.test.* / *.spec.* files.
#
# Uses find(1) + grep(1) so GitHub-hosted ubuntu-latest runners do not need
# ripgrep installed.
#
# Usage: from repo root — bash scripts/ci/assert-no-test-mocks-in-app-src.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Match common Vitest/Jest mock entry points (not plain English "mock" in comments).
PATTERN='vi\.(mock|fn|importActual|hoisted|spyOn|stub)|jest\.(mock|fn|spyOn)'

scan_tree () {
  local label="$1"
  local dir="$2"
  if [[ ! -d "$dir" ]]; then
    return 0
  fi

  local found=false
  while IFS= read -r -d '' f; do
    if match=$(grep -nE "$PATTERN" "$f" 2>/dev/null); then
      if [[ "$found" == false ]]; then
        echo "::error::Test mock APIs (${PATTERN}) found in ${label} application source (outside __tests__ and *.test.* / *.spec.*):"
        found=true
      fi
      echo "${f}"
      echo "${match}"
      echo ""
    fi
  done < <(
    find "$dir" -type f \( -name '*.ts' -o -name '*.tsx' \) \
      ! -path '*/__tests__/*' \
      ! -path '*/e2e/*' \
      ! -name '*.test.ts' \
      ! -name '*.test.tsx' \
      ! -name '*.spec.ts' \
      ! -name '*.spec.tsx' \
      -print0
  )

  if [[ "$found" == true ]]; then
    exit 1
  fi
}

scan_tree "backend" "backend/src"
scan_tree "frontend" "frontend/src"

echo "OK: no Vitest/Jest mock APIs in backend/src or frontend/src application trees."
