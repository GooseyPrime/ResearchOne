-- Migration 028: Retention policy columns, retention_events table, indexes, and backfill.
-- Adds workspace/report expiry tracking to support the report-first retention model.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS and IF NOT EXISTS throughout.
-- Does NOT delete any data.

-- ============================================================
-- 1. research_runs — workspace expiry tracking
-- ============================================================
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS workspace_expires_at TIMESTAMPTZ;
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS workspace_purged_at TIMESTAMPTZ;
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS retention_policy JSONB DEFAULT '{}'::jsonb;

-- ============================================================
-- 2. reports — report + workspace expiry and retention status
-- ============================================================
ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_expires_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS workspace_expires_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS workspace_purged_at TIMESTAMPTZ;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS retention_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS retention_policy JSONB DEFAULT '{}'::jsonb;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS last_retention_notice_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_retention_status_check'
  ) THEN
    ALTER TABLE reports ADD CONSTRAINT reports_retention_status_check
      CHECK (retention_status IN (
        'active',
        'workspace_pending_purge',
        'workspace_purged',
        'pending_expiration',
        'expired',
        'deleted',
        'living_active',
        'living_grace',
        'sovereign_custom'
      ));
  END IF;
END $$;

-- ============================================================
-- 3. sources — per-source retention scope
-- ============================================================
ALTER TABLE sources ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS retention_scope TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE sources ADD COLUMN IF NOT EXISTS retained_for_report_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sources_retention_scope_check'
  ) THEN
    ALTER TABLE sources ADD CONSTRAINT sources_retention_scope_check
      CHECK (retention_scope IN (
        'workspace',
        'living_report',
        'sovereign',
        'admin_hold'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sources_retained_for_report_id_fkey'
  ) THEN
    ALTER TABLE sources ADD CONSTRAINT sources_retained_for_report_id_fkey
      FOREIGN KEY (retained_for_report_id) REFERENCES reports(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 4. ingestion_jobs — expiry tracking
-- ============================================================
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;

-- ============================================================
-- 5. atlas_exports — compression and expiry metadata
-- ============================================================
ALTER TABLE atlas_exports ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE atlas_exports ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;
ALTER TABLE atlas_exports ADD COLUMN IF NOT EXISTS compressed_path TEXT;
ALTER TABLE atlas_exports ADD COLUMN IF NOT EXISTS compressed_bytes BIGINT;
ALTER TABLE atlas_exports ADD COLUMN IF NOT EXISTS uncompressed_bytes BIGINT;

-- ============================================================
-- 6. retention_events audit table
-- ============================================================
CREATE TABLE IF NOT EXISTS retention_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  before_state JSONB DEFAULT '{}'::jsonb,
  after_state JSONB DEFAULT '{}'::jsonb,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. Indexes for retention queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_reports_report_expires_at ON reports(report_expires_at) WHERE report_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_workspace_expires_at ON reports(workspace_expires_at) WHERE workspace_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_retention_status ON reports(retention_status);
CREATE INDEX IF NOT EXISTS idx_research_runs_workspace_expires_at ON research_runs(workspace_expires_at) WHERE workspace_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sources_expires_at ON sources(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_expires_at ON ingestion_jobs(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_atlas_exports_expires_at ON atlas_exports(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retention_events_entity ON retention_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_retention_events_created_at ON retention_events(created_at);

-- ============================================================
-- 8. Backfill expiry timestamps for existing data
-- ============================================================

-- Finalized reports: report_expires_at = finalized_at + 120 days, workspace_expires_at = finalized_at + 30 days
UPDATE reports
SET
  report_expires_at = finalized_at + INTERVAL '120 days',
  workspace_expires_at = finalized_at + INTERVAL '30 days'
WHERE finalized_at IS NOT NULL
  AND report_expires_at IS NULL;

-- Completed research_runs: workspace_expires_at = completed_at + 30 days
UPDATE research_runs
SET workspace_expires_at = completed_at + INTERVAL '30 days'
WHERE completed_at IS NOT NULL
  AND status = 'completed'
  AND workspace_expires_at IS NULL;

-- Failed/cancelled/aborted research_runs: workspace_expires_at = updated_at + 14 days
UPDATE research_runs
SET workspace_expires_at = updated_at + INTERVAL '14 days'
WHERE status IN ('failed', 'cancelled', 'aborted')
  AND workspace_expires_at IS NULL;
