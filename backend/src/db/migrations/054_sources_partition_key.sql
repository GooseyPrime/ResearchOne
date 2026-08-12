-- Work Order Z / Rule 40: deterministic corpus partitions for competence gating.
-- Idempotent and safe to replay.

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS partition_key TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_sources_partition_key ON sources(partition_key)
  WHERE partition_key IS NOT NULL;
