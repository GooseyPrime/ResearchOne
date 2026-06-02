#!/usr/bin/env bash
# Fail if Tier A marketing surfaces contain banned jargon patterns.
# See docs/marketing/tier-a-banned-jargon.txt and Rule 36 (.cursor/rules/36-two-audience-copy.mdc).
#
# Uses grep(1) + sed(1) so GitHub-hosted ubuntu-latest runners do not need ripgrep.
# (Same constraint as assert-no-test-mocks-in-app-src.sh.)
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

# Drop contract-key / slug-key fragments; re-test remainder for banned display copy.
# Narrow exemption: do not drop an entire line because it contains 'general-epistemic':.
strip_contract_fragments() {
  printf '%s' "$1" | sed -E \
    -e "s/'general-epistemic'[[:space:]]*:[[:space:]]*//" \
    -e "s/(id|value|runAddonKey):[[:space:]]*'[^']*'[[:space:]]*,?[[:space:]]*//g"
}

is_display_violation() {
  local line="$1"
  local pattern="$2"
  local stripped
  stripped="$(strip_contract_fragments "$line")"
  # Whitespace-only after stripping → match was contract-only.
  if [[ -z "${stripped//[[:space:]]/}" ]]; then
    return 1
  fi
  if printf '%s\n' "$stripped" | grep -qiE "$pattern"; then
    return 0
  fi
  return 1
}

mapfile -t paths < <(
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] && printf '%s\n' "$line"
  done < "$MANIFEST"
)

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

mapfile -t pattern_lines < <(
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] && printf '%s\n' "$line"
  done < "$PATTERNS"
)

if [[ ${#pattern_lines[@]} -eq 0 ]]; then
  echo "::error::Tier A banned-pattern list is empty: $PATTERNS"
  exit 1
fi

violations=()
for p in "${paths[@]}"; do
  for pattern in "${pattern_lines[@]}"; do
    while IFS= read -r match_line; do
      [[ -z "$match_line" ]] && continue
      file_path="${match_line%%:*}"
      rest="${match_line#*:}"
      line_num="${rest%%:*}"
      line_content="${rest#*:}"
      if is_display_violation "$line_content" "$pattern"; then
        violations+=("${file_path}:${line_num}:${line_content}")
      fi
    done < <(grep -HniE "$pattern" "$p" 2>/dev/null || true)
  done
done

if [[ ${#violations[@]} -gt 0 ]]; then
  printf '%s\n' "${violations[@]}"
  echo "::error::Banned jargon found in Tier A surfaces (see docs/marketing/tier-a-banned-jargon.txt)"
  exit 1
fi

echo "Tier A banned-jargon check passed (${#paths[@]} files)."
