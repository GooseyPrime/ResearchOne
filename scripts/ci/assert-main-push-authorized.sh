#!/usr/bin/env bash
# Fail CI when a commit lands on main without an allowed provenance (Rule 32).
#
# Allowed:
#   - Merge commits (two or more parents)
#   - Squash/merge PR commits whose subject/body references (#<pr-number>)
#   - Explicit direct-main: [direct-main] in commit message (user same-request exception)
#   - Workflow override: ALLOW_DIRECT_MAIN_PUSH=1 (emergency / break-glass in CI env)
#
# Usage (repo root, after checkout at pushed tip):
#   bash scripts/ci/assert-main-push-authorized.sh
set -euo pipefail

if [[ "${ALLOW_DIRECT_MAIN_PUSH:-}" == "1" ]]; then
  echo "main-push-gate: skipped (ALLOW_DIRECT_MAIN_PUSH=1)"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

sha="${GITHUB_SHA:-$(git rev-parse HEAD)}"
msg="$(git log -1 --format=%B "$sha")"
parents="$(git rev-list --parents -n 1 "$sha" | awk '{print NF-1}')"

if [[ "$parents" -ge 2 ]]; then
  echo "main-push-gate: ok (merge commit, $parents parents)"
  exit 0
fi

if echo "$msg" | grep -qiE '\[direct-main\]'; then
  echo "main-push-gate: ok ([direct-main] in commit message)"
  exit 0
fi

# GitHub squash merge titles reference the PR number; merge commits use two parents above.
if echo "$msg" | grep -qE '\(#[0-9]+\)'; then
  echo "main-push-gate: ok (PR reference in commit message)"
  exit 0
fi

# Rebase-and-merge and other single-parent PR integrations: commit is linked to a PR.
repo="${GITHUB_REPOSITORY:-}"
if [[ -n "$repo" ]] && command -v gh >/dev/null 2>&1; then
  pr_count="$(gh api -H "Accept: application/vnd.github+json" \
    "repos/${repo}/commits/${sha}/pulls" 2>/dev/null | jq 'length' 2>/dev/null || echo 0)"
  if [[ "${pr_count:-0}" =~ ^[0-9]+$ ]] && [[ "$pr_count" -gt 0 ]]; then
    echo "main-push-gate: ok (commit associated with PR via GitHub API)"
    exit 0
  fi
fi

echo "::error::Unauthorized direct push to main."
echo "Commit: $sha"
echo "This push does not look like a merged PR (no (#<number>)), merge commit, or [direct-main] marker."
echo ""
echo "Fix: revert or reset main, move work to a PR branch:"
echo "  bash scripts/git/prepare-work-branch.sh <topic>"
echo "For user-authorized hotfix to main, include [direct-main] in the commit message"
echo "or set ALLOW_DIRECT_MAIN_PUSH=1 in the workflow (break-glass only)."
echo ""
echo "First line of commit message:"
echo "$msg" | head -n 1
exit 1
