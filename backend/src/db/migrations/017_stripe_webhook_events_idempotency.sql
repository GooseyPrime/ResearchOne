-- Adjust stripe_webhook_events for proper idempotency tracking.
-- processed_at should be NULL on initial insert and set only after successful processing.
-- Add processing_error column for debugging failed events.

ALTER TABLE stripe_webhook_events
  ALTER COLUMN processed_at DROP DEFAULT,
  ALTER COLUMN processed_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS processing_error TEXT;

-- Update any existing rows that might have been processed_at = NOW() to be considered processed
-- (they were inserted with the old default)
UPDATE stripe_webhook_events SET processed_at = NOW() WHERE processed_at IS NULL;
