**Work Order K --- RLS migration and shared DB isolation**

**Goal. Add row-level security to every customer-data table on shared
B2C database per Section 8 and Section 9.**

**Pre-work: Section 8 (RLS policies), Work Order A schema inventory
(every table to RLS-protect), PostgreSQL RLS docs.**

**Files to create:**

-   **backend/src/db/migrations/20260XXX_rls_setup.sql:**

**CREATE ROLE application_role NOINHERIT;\
GRANT USAGE ON SCHEMA public TO application_role;\
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO
application_role;\
ALTER DEFAULT PRIVILEGES IN SCHEMA public\
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO application_role;\
\
*\-- Append-only on critical tables*\
REVOKE UPDATE, DELETE ON wallet_ledger FROM application_role;\
REVOKE UPDATE, DELETE ON ingestion_audit_log FROM application_role;\
REVOKE UPDATE, DELETE ON stripe_webhook_events FROM application_role;\
REVOKE UPDATE, DELETE ON report_monitor_events FROM application_role;**

-   **backend/src/db/migrations/20260XXX_rls_policies.sql --- for every
    customer-data table:**

**ALTER TABLE corpus_documents ENABLE ROW LEVEL SECURITY;\
CREATE POLICY corpus_documents_user_isolation ON corpus_documents\
FOR ALL TO application_role\
USING (\
user_id = current_setting(\'app.user_id\', true)\
OR (org_id IS NOT NULL AND org_id = current_setting(\'app.org_id\',
true))\
);\
*\-- Repeat for: corpus_chunks, claims, contradictions, kg_entities,
kg_edges,*\
*\-- reports, report_revisions, research_runs, user_wallets,
wallet_ledger,*\
*\-- user_subscriptions, user_tiers, byok_keys,
user_ingestion_consent,*\
*\-- run_ingestion_state, run_user_overrides,*\
*\-- report_monitors, report_monitor_events, provenance_ledgers,*\
*\-- adversarial_twin_runs, tier_addons***

**Files to modify: backend/src/db/index.ts --- connect as
application_role, not superuser. Separate connection pool for
migration/admin.**

**Critical: Per .cursor/rules/13-deploy-skew-and-schema.mdc, code must
tolerate migrations not applied yet. Stage rollout: 1. Apply migration
creating role and grants, but NOT enabling RLS yet 2. Deploy code that
connects as application_role 3. Apply migration enabling RLS and
creating policies 4. Verify in production with read-only checks before
promoting**

**Acceptance criteria: - Two seeded users in DB. Set app.user_id =
user_a. Query corpus_documents returns only user A's docs. Set to
user_b. Returns only user B's. No session var → returns zero rows. -
Team org members can read each other's reports within org but not
outside it - Sovereign tier doesn't use this DB at all (lives on
dedicated DB)**

**Tests required (must fail without the fix): rls.cross-user.test.ts
(seed two users, verify isolation), rls.no-context.test.ts (clear
session var, verify zero rows), rls.org.test.ts (seed org with two
members, verify shared access).**
