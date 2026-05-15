-- @migrate:no-transaction
-- Migration 035: Wave 5.1 — plan intent taxonomy, plan_pending_confirmation run state,
-- account_preferences, research_plans.orchestration_profile, v_dossier refresh.
-- Idempotent where possible. ALTER TYPE cannot run inside a transaction (rule 13).

-- ============================================================
-- 1. job_status: plan_pending_confirmation
-- ============================================================
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'plan_pending_confirmation';

-- ============================================================
-- 2. research_plans — intent CHECK + orchestration_profile
-- ============================================================
ALTER TABLE research_plans DROP CONSTRAINT IF EXISTS research_plans_intent_check;
ALTER TABLE research_plans ADD CONSTRAINT research_plans_intent_check
  CHECK (intent IN (
    'legacy', 'factual_report', 'survey', 'adjudication',
    'investigation', 'literature_review', 'comparative',
    'how_to', 'recommendation', 'exploratory',
    'position_brief', 'timeline', 'reference_lookup'
  ));

ALTER TABLE research_plans ADD COLUMN IF NOT EXISTS orchestration_profile TEXT;

-- ============================================================
-- 3. account_preferences (Wave 5.4 wiring placeholder)
-- ============================================================
CREATE TABLE IF NOT EXISTS account_preferences (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_confirm_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  auto_confirm_threshold  NUMERIC(4,3) NOT NULL DEFAULT 0.850,
  confirmed_streak        INTEGER NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_account_preferences_updated_at ON account_preferences;
CREATE TRIGGER trg_account_preferences_updated_at
  BEFORE UPDATE ON account_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 4. RLS account_preferences
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    RAISE NOTICE '035_plan_intent_taxonomy_and_gate: application_role missing — skipping RLS on account_preferences';
    RETURN;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'account_preferences') THEN
    EXECUTE 'ALTER TABLE account_preferences ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'account_preferences'
        AND policyname = 'account_preferences_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY account_preferences_user_isolation ON account_preferences
        FOR ALL TO application_role
        USING (user_id = current_setting('app.user_id', true))$p$;
    END IF;
  END IF;
END $$;

-- ============================================================
-- 5. v_dossier — gate plan + orchestration_profile; run_status includes new enum
-- ============================================================
CREATE OR REPLACE VIEW v_dossier AS
SELECT
  rr.id                    AS dossier_id,
  rr.id                    AS run_id,
  rr.org_id,
  rr.user_id,
  rr.query                 AS request_query,
  rr.supplemental          AS request_supplemental,
  rr.supplemental_attachments AS request_supplemental_attachments,
  rr.created_at            AS dossier_created_at,
  rr.status::text          AS run_status,
  rp.id                    AS plan_id,
  rp.intent                AS plan_intent,
  rp.orchestration_profile AS plan_orchestration_profile,
  rp.plan_summary          AS plan_summary,
  rp.plan_payload          AS plan_payload,
  rp.status                AS plan_status,
  rp.refinement_rounds     AS plan_refinement_rounds,
  rep.id                   AS report_id,
  rep.title                AS report_title,
  rep.status::text         AS report_status,
  rep.finalized_at         AS report_finalized_at,
  rep.evidence_tier_summary AS report_evidence_tier_summary,
  ds.total_duration_ms,
  ds.tokens_input,
  ds.tokens_output,
  ds.sources_retrieved_count,
  ds.sources_cited_count,
  ds.citation_density,
  ds.skeptic_annotations_count,
  ds.contradictions_count,
  ds.refinement_rounds     AS stats_refinement_rounds,
  ds.agents_ran,
  ds.agents_skipped,
  ds.stage_durations,
  ds.models_used,
  ds.estimated_cost_cents,
  ds.actual_cost_cents
FROM research_runs rr
LEFT JOIN LATERAL (
  SELECT p.*
  FROM research_plans p
  WHERE p.run_id = rr.id
    AND (
      (rr.status::text = 'plan_pending_confirmation' AND p.status IN ('draft', 'pending_confirmation'))
      OR (rr.status::text <> 'plan_pending_confirmation' AND p.status IN ('confirmed', 'legacy'))
    )
  ORDER BY
    CASE
      WHEN rr.status::text = 'plan_pending_confirmation' AND p.status IN ('draft', 'pending_confirmation') THEN 0
      WHEN p.status = 'confirmed' THEN 1
      ELSE 2
    END,
    p.updated_at DESC NULLS LAST
  LIMIT 1
) rp ON true
LEFT JOIN LATERAL (
  SELECT r.*
  FROM reports r
  WHERE r.run_id = rr.id
  ORDER BY r.created_at DESC NULLS LAST
  LIMIT 1
) rep ON true
LEFT JOIN dossier_statistics ds
  ON ds.run_id = rr.id;
