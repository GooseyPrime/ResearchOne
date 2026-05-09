# Runbook: Backfill user_id / org_id on legacy rows

## When to run

After **migration 029** (`029_user_scoped_research_data.sql`) has been
applied. The migration adds `user_id` and `org_id` columns to
`research_runs`, `reports`, `ingestion_jobs`, and `atlas_exports`, but
leaves existing rows `NULL`. This script backfills the values that can
be derived from existing foreign-key relationships.

## How to run

```bash
npx tsx backend/src/scripts/backfillUserScopes.ts
```

The script loads `.env` via `loadEnv()`, connects to the database via
`initDb()`, and uses `adminQuery` (bypasses RLS) so it can see and
update rows that have `NULL` user_id.

## What it does

| Table | Action |
|---|---|
| `reports` | Joins `reports.run_id → research_runs.id` and copies `research_runs.user_id` and `research_runs.org_id` into `reports` where `reports.user_id IS NULL`. |

The script logs the number of rows updated for `reports`.

## What it does NOT do

| Table | Reason |
|---|---|
| `research_runs` | Already the source of truth for `user_id` / `org_id` — new runs are stamped at creation time. Legacy runs without a user_id must be resolved manually or left as legacy. |
| `ingestion_jobs` | No foreign key to a user-bearing table exists in the current schema. These rows will stay `user_id IS NULL` unless manually resolved. |
| `atlas_exports` | Same as `ingestion_jobs` — no derivable ownership. Rows will stay `user_id IS NULL`. |

## Post-run verification

1. Check that no `reports` rows remain un-scoped that should have been
   scoped:

   ```sql
   SELECT count(*) FROM reports WHERE user_id IS NULL AND run_id IS NOT NULL;
   ```

   This should return 0 (or match only runs whose `research_runs.user_id`
   is itself NULL — i.e., truly legacy pre-auth runs).

2. Check `ingestion_jobs` and `atlas_exports` NULL counts for awareness:

   ```sql
   SELECT count(*) FROM ingestion_jobs WHERE user_id IS NULL;
   SELECT count(*) FROM atlas_exports  WHERE user_id IS NULL;
   ```

3. If all critical tables are backfilled and the application's
   `LEGACY_UNSCOPED_READS_GRACE` feature flag is in use, it can be
   flipped off to enforce strict RLS scoping. Verify in staging first.

## Idempotency

The script is safe to re-run. The `WHERE r.user_id IS NULL` guard
means already-backfilled rows are skipped. Re-running on a fully
backfilled database updates 0 rows.
