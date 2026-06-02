# Runbook: Backfill user_id / org_id on legacy rows

## P0 production checklist — cross-tenant report visibility

Run **immediately after** deploying tenant-isolation hardening (fail-closed routes, dossier SQL filters, migration **048**).

### 1. Verify database state

```sql
-- v_dossier must run as invoker (RLS applies)
SELECT reloptions FROM pg_class WHERE relname = 'v_dossier';
-- Expect: {security_invoker=true}

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'application_role');

SELECT count(*) FROM research_runs WHERE user_id IS NULL;
```

High `NULL` counts explain historical shared visibility when RLS was bypassed; backfill (below) before expecting per-user lists to match pre-migration memory.

### 2. Apply migrations through 048

```bash
cd backend && npm run migrate
```

Confirm `048_v_dossier_security_invoker_repair.sql` applied (re-creates `v_dossier` with `WITH (security_invoker = true)`).

### 3. Bootstrap `application_role`

```bash
cd backend && npm run bootstrap:application-role
```

Use `DATABASE_ADMIN_URL` per [application-role-bootstrap.md](./application-role-bootstrap.md). Readiness must show RLS usable:

```bash
curl -sS "$API_BASE/health/ready" | jq '.checks.db'
# Expect: ok: true, rlsReady: true (or application_role_exists)
```

### 4. Backfill NULL scopes

Runs automatically on every Emma deploy via `scripts/deploy-runtime.sh` → `backfillUserScopes.ts`.

Manual run:

```bash
npx tsx backend/src/scripts/backfillUserScopes.ts
```

#### One-shot: assign **all existing** research to a single owner (pre–multi-tenant lock-down)

For production before external users, set GitHub Actions **production** secrets (one deploy only):

| Secret | Value |
|--------|--------|
| `REASSIGN_LEGACY_RESEARCH_OWNER` | `1` |
| `LEGACY_OWNER_EMAIL` | `brandon@intellmeai.com` (or `LEGACY_OWNER_USER_ID` = your Clerk `user_…` id) |
| `LEGACY_RESEARCH_ASSIGN_SCOPE` | `all_existing` (default) |

After a successful deploy, **remove** `REASSIGN_LEGACY_RESEARCH_OWNER` (or set to `0`). The script writes marker `p0_legacy_research_assigned_to_owner_v1` in `app_deploy_markers` so it cannot run again even if the secret is left set.

Requires a row in `users` for the email (sign in once so Clerk sync creates it), unless `LEGACY_OWNER_USER_ID` is set.

For remaining `research_runs` with `user_id IS NULL`, assign ownership manually (Clerk user ids) when you can determine the owner. Legacy NULL rows are **not** visible to normal authenticated users after tenant isolation is enforced.

### 5. Post-deploy verification

1. Test user `GET /api/research` — must not include another user's run IDs.
2. Test user `/app/dossiers` (`GET /api/dossiers`) — only their dossiers.
3. Grep API logs for `legacy_unscoped_read` — must be **absent** (replaced by `tenant_isolation_unavailable` on skew).
4. Optional integration test: `TEST_DATABASE_URL=... cd backend && npm test -- tenantIsolation.integration`

---

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
