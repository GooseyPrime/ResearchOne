-- RLS Setup: application_role and grants.
-- Stage 1 of the deploy-skew rollout: create role and grants BEFORE enabling RLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    CREATE ROLE application_role NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO application_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO application_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO application_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO application_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO application_role;

-- Append-only on critical audit tables
DO $$ BEGIN
  REVOKE UPDATE, DELETE ON wallet_ledger FROM application_role;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE UPDATE, DELETE ON stripe_webhook_events FROM application_role;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- tier_addons is global tier configuration, not customer data.
-- application_role gets read-only access; only admin/migration role mutates it.
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON tier_addons FROM application_role;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
