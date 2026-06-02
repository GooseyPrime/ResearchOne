#!/usr/bin/env bash
# Create (or reset) a PR branch from current origin/main. Run before first edit.
#
# Usage (repo root):
#   bash scripts/git/prepare-work-branch.sh tenant-isolation-guard
#   bash scripts/git/prepare-work-branch.sh feat/my-topic cursor/feat/my-topic
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <topic-slug> [branch-name]" >&2
  exit 1
fi

topic="$1"
branch="${2:-cursor/${topic}}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

git fetch origin

if ! git show-ref --verify --quiet refs/remotes/origin/main; then
  echo "::error::origin/main not found. Run: git fetch origin" >&2
  exit 1
fi

git checkout -B "$branch" origin/main
echo "Ready on branch: $branch (base: origin/main)"
echo "Next: implement, commit, git push -u origin HEAD, open PR into main."
