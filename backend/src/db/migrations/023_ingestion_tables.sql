-- Dual-pipeline ingestion tables per Section 8.

CREATE TABLE IF NOT EXISTS user_ingestion_consent (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pipeline_b_consent BOOLEAN NOT NULL DEFAULT true,
  consent_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS run_ingestion_state (
  run_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pipeline_b_eligible BOOLEAN NOT NULL DEFAULT false,
  pipeline_b_status TEXT NOT NULL DEFAULT 'pending' CHECK (pipeline_b_status IN (
    'pending', 'queued', 'processing', 'completed', 'failed', 'skipped', 'deduplicated'
  )),
  sanitized_artifact_hash TEXT,
  intellme_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS run_user_overrides (
  run_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pipeline_b_opt_out BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_audit_log (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'eligibility_check', 'sanitization_started', 'sanitization_completed',
    'intellme_request_sent', 'intellme_response_received',
    'intellme_deduplicated', 'intellme_error',
    'deletion_requested', 'deletion_completed', 'deletion_error',
    'consent_changed', 'per_run_opt_out'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_audit_log_run
  ON ingestion_audit_log(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_audit_log_user
  ON ingestion_audit_log(user_id, created_at DESC);
