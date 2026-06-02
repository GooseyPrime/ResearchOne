#!/usr/bin/env bash
# Fail if Tier A marketing surfaces contain banned jargon patterns.
# See docs/marketing/tier-a-banned-jargon.txt and Rule 36 (.cursor/rules/36-two-audience-copy.mdc).
#
# Usage: from repo root — bash scripts/ci/assert-tier-a-no-banned-jargon.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MANIFEST="${ROOT}/docs/marketing/tier-a-manifest.txt"
PATTERNS="${ROOT}/docs/marketing/tier-a-banned-jargon.txt"

if [[ ! -f "$MANIFEST" || ! -f "$PATTERNS" ]]; then
  echo "::error::Missing Tier A manifest or banned-pattern list under docs/marketing/"
  exit 1
fi

if ! command -v rg >/dev/null 2>&1; then
  echo "::error::ripgrep (rg) is required for assert-tier-a-no-banned-jargon.sh"
  exit 1
fi

mapfile -t paths < <(grep -v '^\s*#' "$MANIFEST" | grep -v '^\s*$' || true)
if [[ ${#paths[@]} -eq 0 ]]; then
  echo "::error::Tier A manifest is empty: $MANIFEST"
  exit 1
fi

missing=()
for p in "${paths[@]}"; do
  if [[ ! -f "$p" ]]; then
    missing+=("$p")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "::error::Tier A manifest references missing files:"
  printf '  %s\n' "${missing[@]}"
  exit 1
fi

if matches=$(rg -i -n -f "$PATTERNS" "${paths[@]}" 2>/dev/null || true); then
  filtered=$(echo "$matches" | grep -Ev "^\S+:[0-9]+:\s*(id|value|runAddonKey): '|\bgeneral-epistemic':" || true)
  if [[ -n "$filtered" ]]; then
    echo "$filtered"
    echo "::error::Banned jargon found in Tier A surfaces (see docs/marketing/tier-a-banned-jargon.txt)"
    exit 1
  fi
fi

echo "Tier A banned-jargon check passed (${#paths[@]} files)."
