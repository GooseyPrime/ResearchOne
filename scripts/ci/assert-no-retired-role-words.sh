#!/usr/bin/env bash
# Fail if either retired role nickname appears anywhere in the repository
# (file contents or file names), in any letter case. RJ-017.
#
# The same rule is enforced by backend/src/__tests__/retiredRoleWords.test.ts and
# frontend/src/__tests__/wording/retiredRoleWords.test.ts; this script needs no
# npm install, so it can run on every change, including docs-only ones.
#
# The two words are put together from halves so this file passes its own check.
#
# Usage: from repo root — bash scripts/ci/assert-no-retired-role-words.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PATTERN="ste""el[-_ ]?m""an|ske""ptic"

content_hits="$(grep -rIniE "$PATTERN" . \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build \
  --exclude-dir=coverage --exclude-dir=.vercel --exclude-dir=.turbo --exclude-dir=.cache || true)"
name_hits="$(find . \( -name .git -o -name node_modules -o -name dist -o -name build -o -name coverage \) -prune -o -print \
  | grep -iE "$PATTERN" || true)"

if [[ -n "$content_hits" || -n "$name_hits" ]]; then
  echo "::error::A retired role word is in the repository. Use strongest_form / double_check in code and Double-check on screen."
  [[ -n "$content_hits" ]] && printf '%s\n' "$content_hits" | cut -c1-200
  [[ -n "$name_hits" ]] && printf '%s\n' "$name_hits"
  exit 1
fi
echo "Retired role words check passed."
