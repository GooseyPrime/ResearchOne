#!/usr/bin/env bash
# Refuse commits on the default integration branch unless explicitly overridden.
#
# Agents and local dev should work on a PR branch (Rule 32). Override only when
# the user authorized direct-main in the same request:
#   ALLOW_DIRECT_MAIN_PUSH=1 git commit ...
#
# Usage (repo root):
#   bash scripts/git/assert-not-on-main-branch.sh
set -euo pipefail

if [[ "${ALLOW_DIRECT_MAIN_PUSH:-}" == "1" ]]; then
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "::error::Not inside a git work tree."
  exit 1
fi

# actions/checkout@v4 on pull_request leaves a detached HEAD; use the PR head ref.
branch="${GITHUB_HEAD_REF:-${CI_PR_HEAD_REF:-}}"
if [[ -z "$branch" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
if [[ -z "$branch" || "$branch" == "HEAD" ]]; then
  echo "::error::Detached HEAD — create or checkout a PR branch before committing."
  exit 1
fi

case "$branch" in
  main|master)
    echo "::error::Refusing work on default branch '${branch}'."
    echo "Create a PR branch from fresh origin/main:"
    echo "  bash scripts/git/prepare-work-branch.sh <topic-slug>"
    echo "Or, only when the user explicitly authorized direct-main in this request:"
    echo "  ALLOW_DIRECT_MAIN_PUSH=1 git commit ..."
    echo "Commit messages for authorized direct-main pushes must include [direct-main]."
    exit 1
    ;;
esac

exit 0
