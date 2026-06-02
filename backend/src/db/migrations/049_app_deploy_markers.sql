-- Idempotent one-shot deploy/data-fix markers (e.g. legacy ownership reassignment).
CREATE TABLE IF NOT EXISTS app_deploy_markers (
  key TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE app_deploy_markers IS
  'Records completed deploy-time data fixes so scripts do not re-run destructive reassignment.';
