-- ResearchOne Migration 003: runtime health, failures, and checkpoints

ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS failed_stage TEXT,
  ADD COLUMN IF NOT EXISTS failure_meta JSONB DEFAULT '{}';

CREATE TABLE IF NOT EXISTS research_run_checkpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  checkpoint_key TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, checkpoint_key)
);

CREATE INDEX IF NOT EXISTS idx_run_checkpoints_run_stage
  ON research_run_checkpoints(run_id, stage, created_at DESC);
