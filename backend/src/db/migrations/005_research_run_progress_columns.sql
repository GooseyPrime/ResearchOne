-- Live progress fields for polling when WebSocket is missed
ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS progress_stage TEXT,
  ADD COLUMN IF NOT EXISTS progress_percent INT,
  ADD COLUMN IF NOT EXISTS progress_message TEXT,
  ADD COLUMN IF NOT EXISTS progress_updated_at TIMESTAMPTZ;
