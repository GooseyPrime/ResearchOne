-- Exact BullMQ job payload for resuming a failed research run without re-posting the form
ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS resume_job_payload JSONB;
