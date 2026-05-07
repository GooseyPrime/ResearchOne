-- Adjust stripe_webhook_events for proper idempotency tracking.
-- processed_at should be NULL on initial insert and set only after successful processing.
-- Add processing_error column for debugging failed events.
-- Existing rows from the old schema (DEFAULT NOW()) already have processed_at set,
-- so they are treated as "already processed" by the new code — no UPDATE needed.

ALTER TABLE stripe_webhook_events
  ALTER COLUMN processed_at DROP DEFAULT,
  ALTER COLUMN processed_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS processing_error TEXT;
