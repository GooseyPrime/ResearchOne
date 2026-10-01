-- Migration 058: harness results and admin-only per-run flag overrides.
-- Additive. Nullable-safe. Does not alter research_runs and does not touch v_dossier.
-- The code on main before this migration does not read these tables.

CREATE TABLE IF NOT EXISTS eval_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES research_runs(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  scores JSONB NOT NULL,
  git_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eval_results_run_id_idx ON eval_results (run_id);
CREATE INDEX IF NOT EXISTS eval_results_task_id_idx ON eval_results (task_id);

CREATE TABLE IF NOT EXISTS eval_run_overrides (
  run_id UUID PRIMARY KEY REFERENCES research_runs(id) ON DELETE CASCADE,
  flags JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
