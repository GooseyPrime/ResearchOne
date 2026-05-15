-- Migration 036: Wave 5.3 — source_class on claims + report_citations, steelman_summary,
-- dossier_statistics epistemic rollups, v_dossier refresh.
-- Idempotent. Follows 035_plan_intent_taxonomy_and_gate.sql.

-- claims.source_class + steelman_summary
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS source_class TEXT NULL
    CHECK (
      source_class IS NULL OR source_class IN (
        'suppressed_and_recovered',
        'actively_contested',
        'consensus_held',
        'consensus_collapsed'
      )
    );

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS steelman_summary TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_claims_source_class ON claims(source_class)
  WHERE source_class IS NOT NULL;

-- report_citations.source_class (Wave-5.md "citations" → persisted citation rows)
ALTER TABLE report_citations
  ADD COLUMN IF NOT EXISTS source_class TEXT NULL
    CHECK (
      source_class IS NULL OR source_class IN (
        'suppressed_and_recovered',
        'actively_contested',
        'consensus_held',
        'consensus_collapsed'
      )
    );

CREATE INDEX IF NOT EXISTS idx_report_citations_source_class ON report_citations(source_class)
  WHERE source_class IS NOT NULL;

-- dossier_statistics: per-run epistemic snapshot
ALTER TABLE dossier_statistics
  ADD COLUMN IF NOT EXISTS source_class_breakdown JSONB NULL;

ALTER TABLE dossier_statistics
  ADD COLUMN IF NOT EXISTS steelman_pass_count INTEGER NULL;

-- Refresh v_dossier: Wave 5.3 stats + restore 035 single-plan LATERAL + orchestration_profile.
-- WITH (security_invoker = true): RLS on underlying tables runs as querying role (PG15+; dev/prod pg16).
CREATE OR REPLACE VIEW v_dossier
WITH (security_invoker = true)
AS
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
  ds.source_class_breakdown,
  ds.steelman_pass_count,
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
