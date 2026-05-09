# Retention and Workspace Policy

## Product Statement

ResearchOne manages temporary research workspaces and finalized reports
under a time-bounded retention policy. The platform does not promise
indefinite storage; instead, it retains workspace artifacts (raw source
content, document chunks, embeddings) for a limited window after a run
completes, and retains the finalized report (executive summary, sections,
citations, contradiction analysis) for a longer window. Users who need
permanent access should export their reports or convert them to Living
Reports, which suspend workspace cleanup for as long as the monitor
subscription is active.

## Definitions

| Term | Meaning |
|---|---|
| **Workspace** | The transient corpus associated with a single research run: raw source content, parsed documents, chunks, and embeddings. |
| **Finalized report** | The immutable output of a completed research run: title, executive summary, sections, citations, contradiction analysis, falsification criteria, unresolved questions, recommended queries. |
| **Living Report** | A report with an active `living_report` monitor subscription. The retention clock is suspended while the monitor is active. |
| **Workspace purge** | Deletion of raw source content and document/chunk/embedding subtrees. The source row remains (with `raw_content = NULL, purged_at = NOW()`), preserving citation links. |
| **Report expiry** | Soft-deletion of the report row after the retention window elapses. The report transitions to `retention_status = 'expired'`. |
| **Sovereign custom retention** | Enterprise/sovereign deployments may opt out of the standard retention policy via contract. When `SOVEREIGN_CUSTOM_RETENTION=true`, the retention sweep is a no-op. |

## Default Retention Windows

| Event | Window | Env override |
|---|---|---|
| Temporary upload staging | 72 hours | `RETENTION_TEMP_UPLOAD_HOURS` |
| Failed/cancelled/aborted run workspace | 14 days from terminal timestamp | `RETENTION_FAILED_RUN_DAYS` |
| Finalized report workspace | 30 days from `finalized_at` | `RETENTION_FINALIZED_WORKSPACE_DAYS` |
| Finalized report (report itself) | 120 days from `finalized_at` | `RETENTION_REPORT_DAYS` |
| Living Report grace (after monitor cancellation) | 30 days | `RETENTION_LIVING_REPORT_GRACE_DAYS` |

Invariant: `RETENTION_REPORT_DAYS >= RETENTION_FINALIZED_WORKSPACE_DAYS`.
The config builder (`backend/src/config/retention.ts`) enforces this at
startup; violation throws.

## What Is Deleted

During **workspace purge** (the first retention pass):
- `sources.raw_content` is set to `NULL` and `purged_at` is set.
- `documents` rows (and their cascade to `chunks` and `embeddings`) are deleted.
- The `reports.retention_status` transitions from `'active'` to `'workspace_purged'`.
- The associated `research_runs.workspace_purged_at` is set.

During **report expiry** (the second retention pass):
- `reports.retention_status` transitions to `'expired'`.
- The report row itself is NOT deleted — it is soft-expired so that
  the user can still see the title and metadata in their report list.

During **failed-run workspace purge**:
- Same source/document cleanup as workspace purge, scoped to the run's
  `discovered_by_run_id`.

During **Atlas export purge**:
- Exported files on disk are `unlink`ed.
- `atlas_exports.purged_at` is set.

## What Is Preserved

After workspace purge, the following survive indefinitely (until report expiry):
- Report row: title, query, status, executive_summary, sections, citations,
  contradiction analysis, falsification criteria, metadata.
- Source rows: URL, title, fetch metadata (but NOT raw_content).
- Report citations: the citation text and source_id link survive.
- Revision history: all report_revisions and report_revision_sections rows.

After report expiry, the report row remains in the database with
`retention_status = 'expired'` but is excluded from the default list
query (the UI filters on non-expired status).

## User Export Responsibility

Users are responsible for exporting reports they wish to retain beyond
the retention window. The platform provides:
- Markdown download (from the report detail page).
- Atlas export (compressed archive of the full corpus).
- Print/PDF (via browser print dialog).

The UI shows the expiration date on finalized reports so users can plan
their exports.

## Enterprise/Sovereign Custom Retention

Sovereign deployments (`SOVEREIGN_CUSTOM_RETENTION=true`) bypass the
automated retention sweep entirely. Data lifecycle is governed by the
customer's contract and their own operational policies. The retention
cron job runs but short-circuits immediately when sovereign mode is
detected.

## Operational Notes

- The retention sweep runs as a cron job (`retentionCleanupCron.ts`)
  with configurable batch limits (`RETENTION_BATCH_LIMIT`, default 100).
- Dry-run mode (`RETENTION_DRY_RUN=true`) logs what would be purged
  without actually deleting anything. Each action is recorded in the
  `retention_events` table regardless of dry-run mode.
- Living Reports with an active monitor are skipped during workspace
  purge. If the monitor is cancelled, the grace period
  (`livingReportGraceDays`) starts from the cancellation timestamp.
- The `livingReportGraceDays` minimum is 7 in non-test environments;
  the config builder enforces this.
- All retention UPDATEs use deploy-skew-tolerant try/catch on Postgres
  error code `42703` so the retention service degrades gracefully if
  the retention migration has not yet applied.
