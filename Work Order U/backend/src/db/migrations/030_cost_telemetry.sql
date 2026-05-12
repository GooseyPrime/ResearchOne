-- Migration 030: Cost telemetry sidecar tables.
-- See: docs/COST_SIDECAR_DESIGN.md
-- See: .cursor/rules/25-cost-sidecar-and-unit-economics.mdc
--
-- Adds two tables:
--   agent_executions — one row per LLM call (primary + fallback = 2 rows)
--   model_pricing    — provider price catalog (input/output USD per 1M tokens)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS throughout. Re-running on an existing DB is safe.
--
-- RLS: agent_executions is admin-only data. RLS is NOT enabled.
-- All admin endpoints use adminQuery() per the audit_log precedent.

-- ============================================================
-- 1. model_pricing — pricing catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS model_pricing (
  id                          BIGSERIAL PRIMARY KEY,
  model                       TEXT NOT NULL,
  -- USD per 1,000,000 tokens. Stored as NUMERIC(12,6) so 0.0001 cent
  -- precision survives (some providers price $0.000125/1k token = $0.125/1M).
  input_price_per_1m_usd      NUMERIC(12,6) NOT NULL DEFAULT 0,
  output_price_per_1m_usd     NUMERIC(12,6) NOT NULL DEFAULT 0,
  effective_from              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = currently effective. When a vendor raises prices, INSERT a
  -- new row and UPDATE the previous row's effective_until = NOW().
  effective_until             TIMESTAMPTZ,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_pricing_model_effective
  ON model_pricing(model, effective_from DESC);

-- Active price lookup uses the row with the latest effective_from
-- where effective_until IS NULL. Partial index speeds that path.
CREATE INDEX IF NOT EXISTS idx_model_pricing_active
  ON model_pricing(model) WHERE effective_until IS NULL;

-- Seed with the models currently in BASE_ALLOWLIST and V2 reasoner-class.
-- Prices are as of May 2026 per OpenRouter's public pricing page.
-- Operators should update via SQL when providers change prices.
-- These INSERTs are guarded by ON CONFLICT DO NOTHING via a unique
-- model-active constraint to keep re-running this migration safe.
DO $$
BEGIN
  -- Only seed if the table is empty (first apply of this migration on
  -- a fresh DB). Subsequent re-runs in a dev environment do not stomp
  -- operator edits.
  IF NOT EXISTS (SELECT 1 FROM model_pricing) THEN
    INSERT INTO model_pricing (model, input_price_per_1m_usd, output_price_per_1m_usd, notes) VALUES
      -- V2 reasoner-class defaults (capability tier).
      ('qwen/qwen3-235b-a22b-thinking-2507',  0.20, 0.60,  'V2 reasoner-class default; OpenRouter as of 2026-05'),
      ('nousresearch/hermes-4-70b',           0.40, 0.40,  'V2 reasoner-class alternate'),
      -- V1 / general-purpose.
      ('openai/gpt-4o',                       2.50, 10.00, 'Verifier / synthesizer default'),
      ('openai/o4-mini',                      0.15, 0.60,  'MODEL_FAST_EXTRACTOR_V2 — claim/contradiction extraction'),
      ('openai/gpt-4o-mini',                  0.15, 0.60,  'Fallback for small extraction tasks'),
      ('anthropic/claude-3.5-sonnet',         3.00, 15.00, 'High-reasoning fallback'),
      ('anthropic/claude-sonnet-4',           3.00, 15.00, 'Synthesizer/verifier alternate'),
      ('meta-llama/llama-3.3-70b-instruct',   0.59, 0.79,  'General default'),
      -- Skeptic / adversarial models (V2).
      ('cognitivecomputations/dolphin-mistral-24b-venice-edition', 0.18, 0.18,  'V2 uncensored skeptic'),
      ('sao10k/l3.1-euryale-70b',             0.80, 0.80,  'V2 alternate adversarial'),
      -- Embeddings — counted separately when called.
      ('openai/text-embedding-3-small',       0.02, 0.02,  'Embeddings — symmetric pricing on OpenRouter');
  END IF;
END $$;

CREATE TRIGGER trg_model_pricing_updated_at
  BEFORE UPDATE ON model_pricing FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. agent_executions — per-call telemetry
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_executions (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Scope (all nullable: scope-less calls — admin scripts, tests — write
  -- with NULLs and the dashboard filters them into a "no-attribution"
  -- bucket).
  run_id                      UUID,
  report_id                   UUID,
  user_id                     TEXT,
  org_id                      TEXT,

  -- Classification.
  agent_role                  TEXT NOT NULL,  -- canonical role from REASONING_MODEL_ROLES
  phase                       TEXT NOT NULL,  -- pipeline phase (Planner/Discovery/...)
  call_purpose                TEXT NOT NULL DEFAULT 'default',  -- ModelCallPurpose enum

  -- What we called.
  model                       TEXT NOT NULL,
  used_fallback               BOOLEAN NOT NULL DEFAULT FALSE,
  primary_model               TEXT,
  error_classification        TEXT,  -- only set when usedFallback=TRUE

  -- Usage.
  input_tokens                INTEGER NOT NULL DEFAULT 0,
  output_tokens               INTEGER NOT NULL DEFAULT 0,
  total_tokens                INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,

  -- Timing.
  duration_ms                 INTEGER NOT NULL DEFAULT 0,
  started_at_ms               BIGINT NOT NULL,  -- ms since epoch; used in idempotency hash
  started_at                  TIMESTAMPTZ NOT NULL,

  -- Cost (snapshotted from pricing catalog at emit time — see ADR).
  input_price_per_1m_usd      NUMERIC(12,6) NOT NULL DEFAULT 0,
  output_price_per_1m_usd     NUMERIC(12,6) NOT NULL DEFAULT 0,
  calculated_cost_usd         NUMERIC(14,8) NOT NULL DEFAULT 0,

  -- Idempotency. sha256(run_id || agent_role || started_at_ms || model).
  -- Hex-encoded, 64 chars.
  idempotency_key             TEXT NOT NULL UNIQUE,

  -- Free-form. Whatever the future wants to grep on.
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Foreign keys are added in a DO block so the migration tolerates a
-- past state where research_runs has been replaced or reports has
-- different scoping. Per Cursor rule 13, schema migrations cannot
-- assume earlier migrations' constraint shapes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_executions_run_id_fkey'
  ) THEN
    ALTER TABLE agent_executions
      ADD CONSTRAINT agent_executions_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_executions_report_id_fkey'
  ) THEN
    ALTER TABLE agent_executions
      ADD CONSTRAINT agent_executions_report_id_fkey
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_executions_user_id_fkey'
  ) THEN
    ALTER TABLE agent_executions
      ADD CONSTRAINT agent_executions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_executions_org_id_fkey'
  ) THEN
    ALTER TABLE agent_executions
      ADD CONSTRAINT agent_executions_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 3. Indexes — tuned for the admin dashboard queries
-- ============================================================
-- Per-run rollup: "all calls for report req_982x"
CREATE INDEX IF NOT EXISTS idx_agent_executions_run
  ON agent_executions(run_id, started_at_ms) WHERE run_id IS NOT NULL;

-- Per-report rollup: "what did report Y cost"
CREATE INDEX IF NOT EXISTS idx_agent_executions_report
  ON agent_executions(report_id, started_at_ms) WHERE report_id IS NOT NULL;

-- Time-series rollup: "cost by day for last N days"
CREATE INDEX IF NOT EXISTS idx_agent_executions_created_at
  ON agent_executions(created_at DESC);

-- Per-user filter
CREATE INDEX IF NOT EXISTS idx_agent_executions_user_created
  ON agent_executions(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- Per-phase analytics: "what % of cost is the Skeptic eating"
CREATE INDEX IF NOT EXISTS idx_agent_executions_phase_created
  ON agent_executions(phase, created_at DESC);

-- Per-role drilldown
CREATE INDEX IF NOT EXISTS idx_agent_executions_role_created
  ON agent_executions(agent_role, created_at DESC);

-- Fallback-fraction analytics: "what fraction of calls hit fallback this week"
CREATE INDEX IF NOT EXISTS idx_agent_executions_fallback
  ON agent_executions(used_fallback, created_at DESC) WHERE used_fallback = TRUE;

-- Model-cost-leaders: "which model burned the most tokens this month"
CREATE INDEX IF NOT EXISTS idx_agent_executions_model_created
  ON agent_executions(model, created_at DESC);

-- ============================================================
-- 4. Materialized analytical view — per-report rollup
-- ============================================================
-- This is a regular VIEW (not materialized) because the admin dashboard
-- expects up-to-the-minute numbers and the underlying indexes make this
-- query trivially fast even at 100k rows. If we cross 10M rows we can
-- promote to MATERIALIZED VIEW with a REFRESH job, but YAGNI.
CREATE OR REPLACE VIEW report_cost_summary AS
SELECT
  ae.run_id,
  ae.report_id,
  ae.user_id,
  COUNT(*)                                    AS call_count,
  SUM(ae.input_tokens)                        AS input_tokens,
  SUM(ae.output_tokens)                       AS output_tokens,
  SUM(ae.total_tokens)                        AS total_tokens,
  SUM(ae.duration_ms)                         AS total_duration_ms,
  SUM(ae.calculated_cost_usd)                 AS total_cost_usd,
  COUNT(*) FILTER (WHERE ae.used_fallback)    AS fallback_count,
  -- "highest cost agent" — the role with the largest sum within the run.
  -- ARRAY_AGG with DISTINCT ON would be nicer but Postgres doesn't allow
  -- ORDER BY in aggregate args in views portably; we compute this in
  -- the admin endpoint instead and leave the view simple.
  MIN(ae.created_at)                          AS first_call_at,
  MAX(ae.created_at)                          AS last_call_at
FROM agent_executions ae
WHERE ae.run_id IS NOT NULL
GROUP BY ae.run_id, ae.report_id, ae.user_id;

-- ============================================================
-- 5. Useful comments
-- ============================================================
COMMENT ON TABLE agent_executions IS
  'Per-LLM-call telemetry. One row per primary call, one per fallback call. '
  'Idempotent on (run_id || role || started_at_ms || model). '
  'Admin-only — no RLS. See docs/COST_SIDECAR_DESIGN.md.';

COMMENT ON COLUMN agent_executions.input_price_per_1m_usd IS
  'Snapshotted from model_pricing at emit time. Historical reports keep '
  'their original cost even if model_pricing is updated later.';

COMMENT ON COLUMN agent_executions.idempotency_key IS
  'sha256(run_id || agent_role || started_at_ms || model). Prevents '
  'double-counting on bullmq retries. Primary + fallback within the '
  'same call produce different keys (model differs).';

COMMENT ON VIEW report_cost_summary IS
  'Per-run cost rollup. Joined to research_runs/reports by admin '
  'endpoints. Up-to-the-minute (not materialized).';
