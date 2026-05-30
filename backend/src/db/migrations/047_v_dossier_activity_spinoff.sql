-- Migration 047: Extend v_dossier with activity, revision, and spinoff columns (Wave 5.5+).
-- Preserves single-plan LATERAL join + security_invoker (Rule 32 / 33).

DROP VIEW IF EXISTS v_dossier;
CREATE VIEW v_dossier
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
  rr.engine_version        AS engine_version,
  rr.spinoff_from_run_id,
  rr.spinoff_from_report_id,
  (rr.spinoff_from_run_id IS NOT NULL OR rr.spinoff_from_report_id IS NOT NULL) AS is_spinoff,
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
  rep.version_number       AS report_version_number,
  rep.parent_report_id     AS report_parent_report_id,
  COALESCE(rev_stats.revision_count, 0) AS report_revision_count,
  (COALESCE(rev_stats.revision_count, 0) > 0 OR rep.parent_report_id IS NOT NULL) AS is_revised,
  EXISTS (
    SELECT 1 FROM research_runs child
    WHERE child.spinoff_from_run_id = rr.id
       OR (rep.id IS NOT NULL AND child.spinoff_from_report_id = rep.id)
  ) AS has_spinoffs,
  GREATEST(
    rr.created_at,
    rr.completed_at,
    rep.finalized_at,
    rev_stats.last_revision_at
  ) AS last_activity_at,
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
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS revision_count,
    MAX(rv.created_at) AS last_revision_at
  FROM report_revisions rv
  WHERE rv.report_id = rep.id
     OR rv.base_report_id = rep.root_report_id
) rev_stats ON rep.id IS NOT NULL
LEFT JOIN dossier_statistics ds
  ON ds.run_id = rr.id;
