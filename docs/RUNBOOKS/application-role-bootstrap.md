# Runbook: Postgres `application_role` (RLS) bootstrap

## Why this exists

Migration `021_rls_setup.sql` **creates** `application_role` and applies grants when the migration user has **`CREATEROLE`** (or equivalent). On managed Postgres or locked-down roles, `CREATE ROLE` hits `insufficient_privilege` and migration 021 **logs a notice and skips** — migrations still complete, but **`application_role` never appears**.

`/api/health` intentionally treats a missing `application_role` as **core down** (HTTP **503**, `checks.db.ok=false`) so traffic is not advertised as ready without RLS session context.

That state **cannot** be repaired by re-running migration 021 once it is already recorded in `schema_migrations`.

## Connections (two roles, two URLs)

| Purpose | Env | Who connects |
|--------|-----|----------------|
| **Runtime** | `DATABASE_URL` (or `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD`) | The Node API pool — **must not** be a superuser in production. |
| **Privileged bootstrap** | `DATABASE_ADMIN_URL` | One-off / deploy-time only — a role that can `CREATE ROLE` and `GRANT … ON ALL TABLES IN SCHEMA public`. **Never** load this into the API process config. |

`DATABASE_ADMIN_URL` is **only** read by `npm run bootstrap:application-role` and optional `DATABASE_ADMIN_URL_B64` injection from GitHub Actions. **`deploy-runtime.sh` does not `export` the decoded URL** for the whole script: it is passed only into the bootstrap `npm` subshell, then the shell unsets `DATABASE_ADMIN_URL` before PM2 (`--update-env`) so the API never inherits a bootstrap-only credential (PR #110 review).

Bootstrap applies `ALTER DEFAULT PRIVILEGES FOR ROLE <runtime_login>` (tables and sequences) so defaults match migration **021** intent when the privileged session user is **not** the same role that runs migrations — future objects created by the runtime login still grant usage to `application_role`.

## Idempotent bootstrap (repo-supported)

From the repo root (or on the Emma VM under `DEPLOY_ROOT`):

```bash
cd /opt/researchone/backend   # or your checkout
npm run bootstrap:application-role
```

Or from repo root:

```bash
./scripts/bootstrap-application-role.sh
```

**Requires:** `ENV_FILE` or `backend/.env` (via `loadEnv()`, same as the API) with runtime DB settings **and** `DATABASE_ADMIN_URL` when the role is missing or the runtime user cannot `SET ROLE application_role`.

## Production sequence (Emma)

1. **Privileged bootstrap** (once per DB, or after drift): run `npm run bootstrap:application-role` with `DATABASE_ADMIN_URL` set (or rely on GitHub Actions secret `DATABASE_ADMIN_URL` passed as `DATABASE_ADMIN_URL_B64` on deploy — see `.github/workflows/deploy-backend-emma.yml`).
2. **Migrate:** `npm run migrate` (normal migration user — unchanged).
3. **Deploy:** `./scripts/deploy-runtime.sh` (runs migrate → bootstrap → PM2 → health; health must be **HTTP 200** and `status` ≠ `down`).
4. **Verify:** SQL + HTTP checks below.

## Verification SQL

Role exists:

```sql
SELECT rolname, rolinherit, rolcanlogin
FROM pg_roles
WHERE rolname = 'application_role';
```

Runtime login is a member of `application_role` (can `SET ROLE`):

```sql
SELECT r.rolname AS member, g.rolname AS granted_role
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.member
JOIN pg_roles g ON g.oid = m.roleid
WHERE g.rolname = 'application_role'
  AND r.rolname = current_user;
```

(Replace `current_user` with your runtime login, e.g. `researchone`, when run as admin.)

## Verification HTTP

```bash
curl -sS -o /tmp/health.json -w '%{http_code}\n' https://api.example.com/api/health
# Expect first line: 200 when status is ok or degraded (not down)
jq '.status, .checks.db' /tmp/health.json
```

## GitHub Actions

Optional repository secret **`DATABASE_ADMIN_URL`**: if set, the deploy workflow passes it to the VM as **`DATABASE_ADMIN_URL_B64`** (base64). The VM decodes into a **local variable** and passes it only to `npm run bootstrap:application-role` — it is not exported for PM2 (GitHub masks the secret in logs).

**Automatic vs explicit:** Bootstrap runs **automatically** on every `deploy-runtime.sh` via `npm run bootstrap:application-role`. If the role is already OK, the script exits quickly. If not OK and `DATABASE_ADMIN_URL` is unset, **deploy fails** with the script’s error text (no silent skip).

## Related files

- `backend/src/db/migrations/021_rls_setup.sql` — migration-time path (may no-op).
- `backend/src/db/applicationRoleBootstrap.ts` — privileged DDL aligned with 021.
- `backend/src/db/bootstrap-application-role.cli.ts` — CLI entry.
- `scripts/deploy-runtime.sh` — production deploy order + strict health gate.
