-- Migration 012: research_runs aborted terminal state + retry budget bookkeeping
--
-- Background: V2 research runs that hit a transient upstream error were being
-- silently retried by BullMQ (queue-level attempts: 2). The orchestrator would
-- write status='failed', then the next attempt would reset progress_stage back
-- to 'discovery 15%' and the UI showed an infinite running loop. We now keep
-- application-level retry-from-failure as the only retry path, and we add an
-- explicit terminal 'aborted' state for runs whose retry budget is exhausted.
--
-- This migration:
--   1. Adds 'aborted' to job_status (Postgres ENUM extension is non-transactional
--      for ALTER TYPE ADD VALUE; we use IF NOT EXISTS to keep this idempotent).
--   2. Adds retry_budget / retry_attempts columns on research_runs so the API
--      and UI can show "x of y retries used" and disable Resume after the cap.
--
-- Safe rollback: drop the columns; the 'aborted' enum value can remain (Postgres
-- does not support ALTER TYPE DROP VALUE without recreating the type).

ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'aborted';

ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS retry_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_budget   INTEGER NOT NULL DEFAULT 3;

COMMENT ON COLUMN research_runs.retry_attempts IS
  'Number of /retry-from-failure invocations applied to this run. Compared to retry_budget; once equal, the run is moved to status=aborted on the next failure.';
COMMENT ON COLUMN research_runs.retry_budget IS
  'Hard cap on /retry-from-failure invocations. Once retry_attempts >= retry_budget, no further retries are allowed and the row goes to status=aborted on next failure.';
