# WO-AE-5: Supabase Free-Tier Parity Operations

## Overview

Three scheduled cron jobs keep free-tier Supabase projects operationally
equivalent to Pro. See `backend/src/jobs/supabase*Cron.ts` for implementation.
All jobs are registered at server startup in `backend/src/index.ts`.

---

## Cron jobs

| Job | File | Schedule | Purpose |
|-----|------|----------|---------|
| Keep-alive | `supabaseKeepAliveCron.ts` | Every 5 days | Prevents project pause (7-day idle window) |
| Log export | `supabaseLogExportCron.ts` | Every 24 h | Exports logs before free-tier 1-day retention expiry |
| Backup | `supabaseBackupCron.ts` | Every 24 h | `pg_dump` per project to local durable storage |

**All failures are logged at `error` level** — never swallowed — so they are
visible in the log export and can be alerted on.

---

## Configuration

Add to `backend/.env` (and `.env.production`):

```env
# Keep-alive: ping each project every 5 days to prevent pause.
# JSON array of {url, key, label}.
SUPABASE_KEEPALIVE_PROJECTS=[{"url":"https://ftnhzjpyjvpyzetrcfht.supabase.co","key":"<service_role_key>","label":"golden-goose-studio"}]

# Log export: export logs before free-tier 1-day window expires.
# Requires a Supabase Personal Access Token:
# https://supabase.com/dashboard/account/tokens
SUPABASE_MGMT_TOKEN=<personal_access_token>
SUPABASE_LOG_PROJECTS=[{"ref":"ftnhzjpyjvpyzetrcfht","label":"golden-goose-studio"}]
SUPABASE_LOG_DEST=/opt/researchone/logs/supabase

# Backup: pg_dump each project daily.
# Requires pg_dump installed: apt-get install -y postgresql-client
SUPABASE_BACKUP_PROJECTS=[{"url":"postgresql://postgres.<ref>:<password>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres","label":"golden-goose-studio"}]
SUPABASE_BACKUP_DEST=/opt/researchone/backups/supabase
```

---

## Storage requirements

Backup and log destination directories must exist and be writable:

```bash
sudo mkdir -p /opt/researchone/logs/supabase /opt/researchone/backups/supabase
sudo chown -R $USER /opt/researchone/logs /opt/researchone/backups
```

Backup files use `pg_dump --format=custom` (compressed). Estimate ~20–100 MB
per project per day depending on data volume. Keep at least 30 days of backups,
so ~3 GB per project. Mount a dedicated volume if disk is tight.

---

## Security fixes for golden-goose-studio

Apply `golden-goose-studio-security.sql` via the Supabase SQL editor or psql.

This is a one-off manual apply, so it takes a plain connection string — not
`SUPABASE_BACKUP_PROJECTS`, which is the JSON array the backup cron reads and
is not a valid `psql` argument. Copy the string from
**Project Settings → Database → Connection string → URI**:

```bash
export GGS_DATABASE_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
psql "$GGS_DATABASE_URL" -f docs/supabase-ops/golden-goose-studio-security.sql
```

Prefix the `export` with a space (or use `read -rs`) so the password does not
land in shell history.

### Leaked-password protection

This setting is in the Supabase Dashboard only (not SQL-configurable):

1. Open the project: <https://supabase.com/dashboard/project/ftnhzjpyjvpyzetrcfht>
2. Go to **Authentication → Providers → Email**
3. Enable **Leaked Password Protection**

### SECURITY DEFINER functions exposed to `anon`

See `golden-goose-studio-security.sql` for the `REVOKE` statements.

Note: the `rls_enabled_no_policy` findings on `generation_events` and
`generation_quota` are **intentional** — those tables use `REVOKE ALL … FROM
anon, authenticated` and functions access them via `supabaseAdmin`. Do not add
policies to them.
