-- Research run-level model overrides + replayable progress/event telemetry

ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS model_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS model_ensemble JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS progress_events JSONB NOT NULL DEFAULT '[]'::jsonb;

