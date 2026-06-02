#!/usr/bin/env bash
# Install a local pre-commit hook that blocks commits on main/master (Rule 32).
# Optional — CI and agent rules still apply if this is not installed.
#
# Usage (repo root): bash scripts/git/install-pre-commit-hook.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

HOOK_DIR="$ROOT/.git/hooks"
HOOK_PATH="$HOOK_DIR/pre-commit"
ASSERT="$ROOT/scripts/git/assert-not-on-main-branch.sh"

if [[ ! -d "$ROOT/.git" ]]; then
  echo "::error::No .git directory — run from a clone of this repository." >&2
  exit 1
fi

mkdir -p "$HOOK_DIR"

MARKER='Installed by scripts/git/install-pre-commit-hook.sh'

if [[ -f "$HOOK_PATH" ]]; then
  if grep -qF "$MARKER" "$HOOK_PATH" 2>/dev/null; then
    : # safe to refresh our hook
  elif grep -q 'assert-not-on-main-branch.sh' "$HOOK_PATH" 2>/dev/null; then
    echo "::warning::pre-commit calls assert-not-on-main-branch.sh but was not installed by this script; not overwriting." >&2
    echo "  Merge manually or remove the hook and re-run: bash scripts/git/install-pre-commit-hook.sh" >&2
    exit 1
  else
    echo "::warning::Existing pre-commit hook preserved; append manually or merge:" >&2
    echo "  bash \"$ASSERT\"" >&2
    exit 1
  fi
fi

cat >"$HOOK_PATH" <<'EOF'
#!/usr/bin/env bash
# Installed by scripts/git/install-pre-commit-hook.sh — do not commit this file.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
bash "${ROOT}/scripts/git/assert-not-on-main-branch.sh"
EOF

chmod +x "$HOOK_PATH"
echo "Installed pre-commit hook at $HOOK_PATH"
