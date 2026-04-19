-- Single-row table for optional per-role model overrides (merged with env at runtime).
CREATE TABLE IF NOT EXISTS runtime_model_overrides (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  overrides JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO runtime_model_overrides (id, overrides)
VALUES (1, '{}')
ON CONFLICT (id) DO NOTHING;
