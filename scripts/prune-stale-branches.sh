#!/usr/bin/env bash
# WO-AE-9: Prune stale remote branches on ResearchOne.
#
# Deletes remote branches whose PR is merged or closed (never-opened branches
# are skipped). Safe branches are explicitly excluded.
#
# Usage (dry-run, default):
#   bash scripts/prune-stale-branches.sh
#
# Usage (live delete — irreversible):
#   DRY_RUN=0 bash scripts/prune-stale-branches.sh
#
# Requirements: gh CLI authenticated (gh auth status), git with origin remote.
#
# The script writes a log of every decision to /tmp/prune-branches-<timestamp>.log.

set -euo pipefail

DRY_RUN="${DRY_RUN:-1}"
REPO="GooseyPrime/ResearchOne"
LOG_FILE="/tmp/prune-branches-$(date +%Y%m%d-%H%M%S).log"
DELETED=0
SKIPPED_OPEN=0
SKIPPED_PROTECTED=0
SKIPPED_NO_PR=0

# Branches that must never be deleted regardless of PR state.
PROTECTED_BRANCHES=(
  "main"
  "copilot/wo-ae"
  "cursor/revision-spinoff-dossier-timeline-fa53"
)

log() { echo "$@" | tee -a "${LOG_FILE}"; }

is_protected() {
  local branch="$1"
  for p in "${PROTECTED_BRANCHES[@]}"; do
    [[ "${branch}" == "${p}" ]] && return 0
  done
  return 1
}

log "=== ResearchOne stale-branch prune — $(date -u) ==="
log "DRY_RUN=${DRY_RUN}  REPO=${REPO}"
log ""

# Fetch all remote branches (paginated so branch count > 200 is handled)
mapfile -t BRANCHES < <(gh api --paginate "repos/${REPO}/branches?per_page=100" --jq '.[].name')

log "Found ${#BRANCHES[@]} remote branches."
log ""

for branch in "${BRANCHES[@]}"; do
  if is_protected "${branch}"; then
    log "[KEEP    ] ${branch} (protected)"
    (( SKIPPED_PROTECTED++ )) || true
    continue
  fi

  # Look up the most recent PR for this branch (any state).
  PR_STATE=$(gh pr list \
    --repo "${REPO}" \
    --head "${branch}" \
    --state all \
    --json state \
    --jq '.[0].state // "NONE"' 2>/dev/null || echo "NONE")

  case "${PR_STATE}" in
    MERGED|CLOSED)
      log "[DELETE  ] ${branch} (PR state: ${PR_STATE})"
      if [[ "${DRY_RUN}" != "0" ]]; then
        log "           (dry-run — not deleting)"
      else
        # Branch names contain `/` (cursor/foo, copilot/bar). The refs API
        # needs those percent-encoded or the DELETE 404s and nothing is
        # pruned while the script reports success (Copilot, #224).
        encoded_branch="$(printf '%s' "${branch}" | jq -sRr @uri)"
        gh api -X DELETE "repos/${REPO}/git/refs/heads/${encoded_branch}" && \
          log "           deleted." || \
          log "           ERROR: delete failed"
      fi
      (( DELETED++ )) || true
      ;;
    OPEN)
      log "[KEEP    ] ${branch} (PR state: OPEN)"
      (( SKIPPED_OPEN++ )) || true
      ;;
    NONE)
      log "[NO-PR   ] ${branch} (no PR found — skipping)"
      (( SKIPPED_NO_PR++ )) || true
      ;;
    *)
      log "[SKIP    ] ${branch} (unknown PR state: ${PR_STATE})"
      ;;
  esac
done

log ""
log "=== Summary ==="
log "  Deleted (or would delete): ${DELETED}"
log "  Kept (protected):          ${SKIPPED_PROTECTED}"
log "  Kept (open PR):            ${SKIPPED_OPEN}"
log "  No PR found (skipped):     ${SKIPPED_NO_PR}"
log "  Log: ${LOG_FILE}"

if [[ "${DRY_RUN}" != "0" ]]; then
  log ""
  log "This was a DRY RUN. To delete: DRY_RUN=0 bash scripts/prune-stale-branches.sh"
fi
