-- Migration 034: Dossier data model (Wave 5.0).
-- research_plans, plan_revisions, dossier_statistics, v_dossier.
-- Idempotent. Follows migration 033 (citation_style); Wave plan "033" was renumbered.
--
-- DOWN (manual rollback — uncomment if needed):
-- DROP VIEW IF EXISTS v_dossier;
-- DROP TABLE IF EXISTS plan_revisions;
-- DROP TABLE IF EXISTS dossier_statistics;
-- DROP TABLE IF EXISTS research_plans;

-- ============================================================
-- 1. research_plans
-- ============================================================
CREATE TABLE IF NOT EXISTS research_plans (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id                UUID NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  org_id                TEXT NULL REFERENCES orgs(id) ON DELETE SET NULL,
  user_id               TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'legacy'
                        CHECK (status IN (
                          'legacy', 'draft', 'pending_confirmation',
                          'confirmed', 'superseded'
                        )),
  intent                TEXT NOT NULL DEFAULT 'legacy',
  intent_confidence     NUMERIC(4,3) NULL,
  plan_payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan_summary          TEXT NULL,
  refinement_rounds     INTEGER NOT NULL DEFAULT 0,
  confirmed_at          TIMESTAMPTZ NULL,
  superseded_at         TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_plans_run_id ON research_plans(run_id);
CREATE INDEX IF NOT EXISTS idx_research_plans_org_user ON research_plans(org_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_research_plans_run_active
  ON research_plans(run_id)
  WHERE status IN ('draft', 'pending_confirmation', 'confirmed');

DROP TRIGGER IF EXISTS trg_research_plans_updated_at ON research_plans;
CREATE TRIGGER trg_research_plans_updated_at
  BEFORE UPDATE ON research_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. plan_revisions
-- ============================================================
CREATE TABLE IF NOT EXISTS plan_revisions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id               UUID NOT NULL REFERENCES research_plans(id) ON DELETE CASCADE,
  revision_number       INTEGER NOT NULL,
  refinement_prompt     TEXT NULL,
  prior_plan_payload    JSONB NULL,
  new_plan_payload      JSONB NOT NULL,
  diff_summary          TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (plan_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_plan_revisions_plan_id ON plan_revisions(plan_id, revision_number);

-- ============================================================
-- 3. dossier_statistics
-- ============================================================
CREATE TABLE IF NOT EXISTS dossier_statistics (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id                      UUID NOT NULL UNIQUE REFERENCES research_runs(id) ON DELETE CASCADE,
  total_duration_ms           BIGINT NULL,
  tokens_input                BIGINT NULL,
  tokens_output               BIGINT NULL,
  sources_retrieved_count     INTEGER NULL,
  sources_cited_count         INTEGER NULL,
  citation_density            NUMERIC(6,3) NULL,
  skeptic_annotations_count   INTEGER NULL,
  contradictions_count        INTEGER NULL,
  refinement_rounds           INTEGER NULL,
  agents_ran                  JSONB NULL,
  agents_skipped              JSONB NULL,
  stage_durations             JSONB NULL,
  models_used                 JSONB NULL,
  estimated_cost_cents        INTEGER NULL,
  actual_cost_cents           INTEGER NULL,
  computed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dossier_statistics_run_id ON dossier_statistics(run_id);

-- ============================================================
-- 4. Canonical view v_dossier
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
  rr.status::text         AS run_status,
  rp.id                    AS plan_id,
  rp.intent                AS plan_intent,
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
LEFT JOIN research_plans rp
  ON rp.run_id = rr.id
 AND rp.status IN ('confirmed', 'legacy')
LEFT JOIN LATERAL (
  SELECT r.*
  FROM reports r
  WHERE r.run_id = rr.id
  ORDER BY r.created_at DESC NULLS LAST
  LIMIT 1
) rep ON true
LEFT JOIN dossier_statistics ds
  ON ds.run_id = rr.id;

-- ============================================================
-- 5. RLS (mirror research_runs / reports isolation)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    RAISE NOTICE '034_dossier_data_model: application_role missing — skipping RLS';
    RETURN;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'research_plans') THEN
    EXECUTE 'ALTER TABLE research_plans ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'research_plans'
        AND policyname = 'research_plans_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY research_plans_user_isolation ON research_plans
        FOR ALL TO application_role
        USING (
          user_id = current_setting('app.user_id', true)
          OR (org_id IS NOT NULL AND org_id = current_setting('app.org_id', true))
        )$p$;
    END IF;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'plan_revisions') THEN
    EXECUTE 'ALTER TABLE plan_revisions ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_revisions'
        AND policyname = 'plan_revisions_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY plan_revisions_user_isolation ON plan_revisions
        FOR ALL TO application_role
        USING (
          EXISTS (
            SELECT 1 FROM research_plans rp
            WHERE rp.id = plan_revisions.plan_id
              AND (
                rp.user_id = current_setting('app.user_id', true)
                OR (rp.org_id IS NOT NULL AND rp.org_id = current_setting('app.org_id', true))
              )
          )
        )$p$;
    END IF;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dossier_statistics') THEN
    EXECUTE 'ALTER TABLE dossier_statistics ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dossier_statistics'
        AND policyname = 'dossier_statistics_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY dossier_statistics_user_isolation ON dossier_statistics
        FOR ALL TO application_role
        USING (
          EXISTS (
            SELECT 1 FROM research_runs r
            WHERE r.id = dossier_statistics.run_id
              AND (
                r.user_id = current_setting('app.user_id', true)
                OR (r.org_id IS NOT NULL AND r.org_id = current_setting('app.org_id', true))
              )
          )
        )$p$;
    END IF;
  END IF;
END $$;

-- ============================================================
-- 6. Back-fill (idempotent)
-- ============================================================
INSERT INTO research_plans (run_id, org_id, user_id, status, intent, plan_payload, plan_summary, confirmed_at, created_at)
SELECT rr.id, rr.org_id, rr.user_id, 'legacy', 'legacy', '{}'::jsonb, NULL, rr.completed_at, rr.created_at
FROM research_runs rr
WHERE rr.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM research_plans rp WHERE rp.run_id = rr.id);

INSERT INTO dossier_statistics (run_id, total_duration_ms, refinement_rounds, computed_at)
SELECT rr.id,
       CASE
         WHEN rr.completed_at IS NOT NULL AND rr.created_at IS NOT NULL
           THEN (EXTRACT(EPOCH FROM (rr.completed_at - rr.created_at)) * 1000)::bigint
         ELSE NULL
       END,
       0,
       NOW()
FROM research_runs rr
WHERE rr.completed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dossier_statistics ds WHERE ds.run_id = rr.id);
