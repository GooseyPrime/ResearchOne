#!/usr/bin/env bash
# Create (or reuse) a PR branch. Run before first edit.
#
# Usage (repo root):
#   bash scripts/git/prepare-work-branch.sh tenant-isolation-guard
#   bash scripts/git/prepare-work-branch.sh feat/my-topic cursor/feat/my-topic
#   bash scripts/git/prepare-work-branch.sh feat/my-topic --reuse   # reuse current non-main branch
#
# Ordered integration strategy (Rule 32):
#   1. PREFERRED  — environment already supplies a non-main branch; use --reuse
#   2. NORMAL     — create/reset a new branch from origin/main (default)
#   3. RESTRICTED — push (run separately) fails with GH013; this script prints
#                   a structured guidance block at the end of a successful run
#                   so agents know what to do if the subsequent push is blocked.
#
# NOTE: this script prepares local branch state only — it does NOT push.
# "Ready on branch" means the local checkout succeeded; it does NOT guarantee
# the remote ref can be created. If the later push fails with GH013, follow
# the BLOCKED_GITHUB_REF_CREATION guidance printed at the end of this script.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <topic-slug> [branch-name|--reuse]" >&2
  exit 1
fi

topic="$1"
arg2="${2:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# --reuse: keep the current non-main branch as-is (environment pre-created it)
if [[ "$arg2" == "--reuse" ]]; then
  current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
  if [[ "$current" == "main" || "$current" == "master" || "$current" == "HEAD" ]]; then
    echo "::error::--reuse given but current branch is '${current}'. Check out a non-default PR branch first." >&2
    exit 1
  fi
  if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    echo "::warning::Dirty worktree on branch '${current}' — keeping as-is (--reuse)."
  fi
  echo "Reusing existing branch: ${current}"
  echo "Next: implement, commit, git push -u origin HEAD, open/update PR into main."
  exit 0
fi

branch="${arg2:-cursor/${topic}}"

# Guard: refuse to proceed with a dirty worktree. `git checkout -B` carries
# uncommitted changes onto the new/reset branch, which can lead to accidental
# commits of work-in-progress. Block on any branch, not only the target branch.
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
  echo "::error::Dirty worktree on branch '${current}'. Commit or stash before creating/resetting '${branch}'." >&2
  exit 1
fi

git fetch origin

if ! git show-ref --verify --quiet refs/remotes/origin/main; then
  echo "::error::origin/main not found after fetch. Check remote configuration." >&2
  exit 1
fi

# Create or reset the branch locally.
if ! git checkout -B "$branch" origin/main 2>/tmp/git_checkout_err_$$; then
  cat /tmp/git_checkout_err_$$ >&2
  rm -f /tmp/git_checkout_err_$$
  exit 1
fi
rm -f /tmp/git_checkout_err_$$

echo "Ready on branch: $branch (base: origin/main)"
echo ""
echo "Next: implement, commit, then push:"
echo "  git push -u origin HEAD"
echo ""
echo "If push fails with 'GH013: Cannot create ref':"
echo ""
echo "  BLOCKED_GITHUB_REF_CREATION"
echo "  attempted_branch=${branch}"
echo "  base=origin/main"
echo "  resolution=One of:"
echo "    (1) Ask a maintainer to pre-create branch '${branch}' and assign you to it."
echo "    (2) Use an existing writable PR branch: bash $0 <topic> --reuse"
echo "    (3) Request same-task direct-main authorization from the user (requires [direct-main] in commit)."
echo "    (4) Ask a repo admin to allow ref creation for the copilot/** prefix in the repository ruleset."
