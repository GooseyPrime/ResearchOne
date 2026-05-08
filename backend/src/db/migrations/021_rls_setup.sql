-- RLS Setup: application_role and grants.
-- Stage 1 of the deploy-skew rollout: create role and grants BEFORE enabling RLS.
--
-- Runtime model: the app connects as the normal login user, then does
-- SET ROLE application_role inside each transaction for RLS enforcement.
-- RESET ROLE restores the login user after the transaction.
--
-- Graceful degradation: if the migration user lacks CREATEROLE privilege
-- (common in managed Postgres or restricted environments), the role creation
-- is skipped and the rest of the migration no-ops. The runtime (pool.ts)
-- already tolerates a missing application_role (catches 42704).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    CREATE ROLE application_role NOINHERIT NOLOGIN;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE '021_rls_setup: cannot CREATE ROLE (no CREATEROLE privilege) — skipping RLS role setup';
END $$;

-- Everything below requires the role to exist. Gate on pg_roles so we
-- degrade cleanly when CREATE ROLE was skipped above.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    RAISE NOTICE '021_rls_setup: application_role does not exist — skipping grants';
    RETURN;
  END IF;

  -- The login user must be allowed to SET ROLE to application_role
  BEGIN
    EXECUTE format('GRANT application_role TO %I', current_user);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO application_role';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO application_role';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO application_role';

  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO application_role';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO application_role';

  -- Harden: prevent application_role from creating objects in public schema
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM application_role';

  -- Append-only on critical audit tables
  BEGIN
    EXECUTE 'REVOKE UPDATE, DELETE ON wallet_ledger FROM application_role';
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    EXECUTE 'REVOKE UPDATE, DELETE ON stripe_webhook_events FROM application_role';
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- tier_addons is global tier configuration, not customer data.
  -- application_role gets read-only access; only admin/migration role mutates it.
  BEGIN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON tier_addons FROM application_role';
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END $$;
