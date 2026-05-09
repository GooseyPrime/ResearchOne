-- Migration 029: User-scoped research data — multi-tenant isolation.
-- Adds user_id (and org_id where applicable) to research_runs, reports,
-- ingestion_jobs, and atlas_exports. Enables RLS on these tables so that
-- authenticated users can only see their own data (or org-shared data).
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS and IF NOT EXISTS throughout.
-- Does NOT delete any data. Existing rows keep user_id IS NULL until
-- backfilled. NOTE: RLS policies match on user_id/org_id, so NULL rows
-- are invisible to application_role sessions. The route-layer predicates
-- include OR user_id IS NULL as a grace path; once the backfill script
-- has run, the NULL clause becomes a no-op.
--
-- Sources are intentionally NOT scoped here — they remain a shared corpus.
-- DELETE protection on sources is enforced at the route layer.

-- ============================================================
-- 1. research_runs — user_id + org_id
-- ============================================================
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS user_id TEXT NULL;
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS org_id TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'research_runs_user_id_fkey'
  ) THEN
    ALTER TABLE research_runs
      ADD CONSTRAINT research_runs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'research_runs_org_id_fkey'
  ) THEN
    ALTER TABLE research_runs
      ADD CONSTRAINT research_runs_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 2. reports — user_id + org_id
-- ============================================================
ALTER TABLE reports ADD COLUMN IF NOT EXISTS user_id TEXT NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS org_id TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_user_id_fkey'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_org_id_fkey'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 3. ingestion_jobs — user_id only (no org sharing for ingestion)
-- ============================================================
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS user_id TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_jobs_user_id_fkey'
  ) THEN
    ALTER TABLE ingestion_jobs
      ADD CONSTRAINT ingestion_jobs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 4. atlas_exports — user_id only
-- ============================================================
ALTER TABLE atlas_exports ADD COLUMN IF NOT EXISTS user_id TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'atlas_exports_user_id_fkey'
  ) THEN
    ALTER TABLE atlas_exports
      ADD CONSTRAINT atlas_exports_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 5. Partial indexes for user-scoped queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_research_runs_user_id ON research_runs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_research_runs_org_id ON research_runs(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_org_id ON reports(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_user_id ON ingestion_jobs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_atlas_exports_user_id ON atlas_exports(user_id) WHERE user_id IS NOT NULL;

-- ============================================================
-- 6. RLS policies — gated behind application_role existence
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    RAISE NOTICE '029_user_scoped_research_data: application_role does not exist — skipping RLS policy creation';
    RETURN;
  END IF;

  -- research_runs
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'research_runs') THEN
    EXECUTE 'ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'research_runs'
        AND policyname = 'research_runs_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY research_runs_user_isolation ON research_runs
        FOR ALL TO application_role
        USING (
          user_id = current_setting('app.user_id', true)
          OR (org_id IS NOT NULL AND org_id = current_setting('app.org_id', true))
        )$p$;
    END IF;
  END IF;

  -- reports
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'reports') THEN
    EXECUTE 'ALTER TABLE reports ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'reports'
        AND policyname = 'reports_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY reports_user_isolation ON reports
        FOR ALL TO application_role
        USING (
          user_id = current_setting('app.user_id', true)
          OR (org_id IS NOT NULL AND org_id = current_setting('app.org_id', true))
        )$p$;
    END IF;
  END IF;

  -- ingestion_jobs
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ingestion_jobs') THEN
    EXECUTE 'ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'ingestion_jobs'
        AND policyname = 'ingestion_jobs_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY ingestion_jobs_user_isolation ON ingestion_jobs
        FOR ALL TO application_role
        USING (
          user_id = current_setting('app.user_id', true)
        )$p$;
    END IF;
  END IF;

  -- atlas_exports
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'atlas_exports') THEN
    EXECUTE 'ALTER TABLE atlas_exports ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'atlas_exports'
        AND policyname = 'atlas_exports_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY atlas_exports_user_isolation ON atlas_exports
        FOR ALL TO application_role
        USING (
          user_id = current_setting('app.user_id', true)
        )$p$;
    END IF;
  END IF;

END $$;
