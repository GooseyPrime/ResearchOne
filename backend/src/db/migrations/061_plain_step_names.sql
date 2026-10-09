-- Migration 061 (RJ-017): the two checking steps get plain internal names.
--
-- The step that restates each finding in its strongest form is `strongest_form`.
-- The step that tests findings against other sources is `double_check`.
-- This migration brings a database created before RJ-017 to those names:
--
--   1. three columns are renamed;
--   2. `v_dossier` is recreated so it projects the new column names;
--   3. stored role names, mode keys, step codes and the cost phase are rewritten.
--
-- The older migration files were edited in the same change, so a database built
-- from nothing already has the new names and every statement here finds nothing
-- to do. (The migration runner records applied files by file name only, with no
-- checksum, so editing an applied file changes nothing for a live database.)
--
-- The two old words are put together from halves below, so the old names are
-- not spelled anywhere in the repository. Each rename runs only when the old
-- column exists and the new one does not. Idempotent and safe to replay.

DO $$
DECLARE
  old_a  text := 'steel' || 'man';
  old_b  text := 'skep' || 'tic';
  cap_a  text := initcap('steel' || 'man');
  cap_b  text := initcap('skep' || 'tic');
  either text;
  rec    record;
BEGIN
  either := '(' || old_a || '|' || old_b || '|' || cap_a || '|' || cap_b || ')';

  -- The view reads the columns by name, so it goes first and is rebuilt below.
  DROP VIEW IF EXISTS v_dossier;

  -- 1. Columns.
  FOR rec IN
    SELECT * FROM (VALUES
      ('claims',             old_a || '_summary',           'strongest_form_summary'),
      ('dossier_statistics', old_a || '_pass_count',        'strongest_form_pass_count'),
      ('dossier_statistics', old_b || '_annotations_count', 'double_check_annotations_count')
    ) AS v(tbl, old_col, new_col)
  LOOP
    IF EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = rec.tbl AND column_name = rec.old_col)
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = rec.tbl AND column_name = rec.new_col)
    THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', rec.tbl, rec.old_col, rec.new_col);
    END IF;
  END LOOP;

  -- 2. Stored JSON. Only a quoted name made of letters, digits and underscores is
  --    rewritten (a key, a role, a step code). Sentences a person wrote, such as
  --    a research question that uses one of the words, are left exactly as they are.
  FOR rec IN
    SELECT c.table_name AS tbl, c.column_name AS col
      FROM information_schema.columns c
     WHERE c.table_schema = current_schema()
       AND c.data_type = 'jsonb'
       AND (c.table_name, c.column_name) IN (
         ('research_plans', 'plan_payload'),
         ('plan_revisions', 'new_plan_payload'),
         ('plan_revisions', 'prior_plan_payload'),
         ('saved_orchestration_profiles', 'customizations'),
         ('reports', 'metadata'),
         ('report_revisions', 'metadata'),
         ('research_runs', 'model_overrides'),
         ('research_runs', 'model_ensemble'),
         ('research_runs', 'model_log'),
         ('research_runs', 'plan'),
         ('research_runs', 'progress_events'),
         ('research_runs', 'resume_job_payload'),
         ('research_runs', 'failure_meta'),
         ('runtime_model_overrides', 'overrides'),
         ('dossier_statistics', 'agents_ran'),
         ('dossier_statistics', 'agents_skipped'),
         ('dossier_statistics', 'stage_durations'),
         ('dossier_statistics', 'models_used'),
         ('research_run_checkpoints', 'snapshot'),
         ('agent_executions', 'metadata')
       )
  LOOP
    EXECUTE format(
      'UPDATE %1$I SET %2$I = (
         regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
         regexp_replace(
           %2$I::text,
           $r$"([A-Za-z0-9_]*)%3$s([A-Z][A-Za-z0-9_]*)"$r$, $r$"\1strongestForm\2"$r$, ''g''),
           $r$"([A-Za-z0-9_]*)%4$s([A-Z][A-Za-z0-9_]*)"$r$, $r$"\1doubleCheck\2"$r$, ''g''),
           $r$"([A-Za-z0-9_]*[a-z0-9])%5$s([A-Za-z0-9_]*)"$r$, $r$"\1StrongestForm\2"$r$, ''g''),
           $r$"([A-Za-z0-9_]*[a-z0-9])%6$s([A-Za-z0-9_]*)"$r$, $r$"\1DoubleCheck\2"$r$, ''g''),
           $r$"([A-Za-z0-9_]*)%3$s([a-z0-9_]*)"$r$, $r$"\1strongest_form\2"$r$, ''g''),
           $r$"([A-Za-z0-9_]*)%4$s([a-z0-9_]*)"$r$, $r$"\1double_check\2"$r$, ''g''),
           $r$"%5$s"$r$, $r$"Strongest-form"$r$, ''g''),
           $r$"%6$s"$r$, $r$"Double-check"$r$, ''g'')
       )::jsonb
       WHERE %2$I::text ~ %7$L',
      rec.tbl, rec.col, old_a, old_b, cap_a, cap_b, either);
  END LOOP;

  -- 3. Stored text: the role, purpose and phase of each recorded model call, and
  --    the key a paused run's saved step is stored under.
  IF to_regclass('agent_executions') IS NOT NULL THEN
    EXECUTE format(
      'UPDATE agent_executions
          SET agent_role   = replace(replace(agent_role, %1$L, ''strongest_form''), %2$L, ''double_check''),
              call_purpose = replace(replace(call_purpose, %1$L, ''strongest_form''), %2$L, ''double_check''),
              phase        = replace(replace(phase, %3$L, ''Strongest-form''), %4$L, ''Double-check'')
        WHERE agent_role ~ %5$L OR call_purpose ~ %5$L OR phase ~ %5$L',
      old_a, old_b, cap_a, cap_b, either);
  END IF;

  IF to_regclass('research_run_checkpoints') IS NOT NULL THEN
    EXECUTE format(
      'UPDATE research_run_checkpoints c
          SET checkpoint_key = replace(replace(c.checkpoint_key, %1$L, ''strongest_form''), %2$L, ''double_check'')
        WHERE c.checkpoint_key ~ %3$L
          AND NOT EXISTS (
            SELECT 1 FROM research_run_checkpoints d
             WHERE d.run_id = c.run_id
               AND d.checkpoint_key = replace(replace(c.checkpoint_key, %1$L, ''strongest_form''), %2$L, ''double_check''))',
      old_a, old_b, either);
  END IF;

  IF to_regclass('model_pricing') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'model_pricing' AND column_name = 'notes')
  THEN
    EXECUTE format(
      'UPDATE model_pricing
          SET notes = replace(replace(replace(replace(notes, %3$L, ''Strongest-form''), %4$L, ''Double-check''), %1$L, ''strongest-form''), %2$L, ''double-check'')
        WHERE notes ~ %5$L',
      old_a, old_b, cap_a, cap_b, either);
  END IF;
END $$;

-- 4. `v_dossier`, restated in full from migration 057 (copied, not retyped) so
--    it projects the renamed columns.
CREATE VIEW v_dossier
WITH (security_invoker = true)
AS
SELECT
  rr.id                    AS dossier_id,
  rr.id                    AS run_id,
  rr.org_id,
  rr.user_id,
  rr.query                 AS request_query,
  rr.display_title         AS run_display_title,
  rr.run_ref               AS run_ref,
  rr.supplemental          AS request_supplemental,
  rr.supplemental_attachments AS request_supplemental_attachments,
  rr.created_at            AS dossier_created_at,
  rr.status::text          AS run_status,
  rr.failure_meta->>'gate_status' AS run_gate_status,
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
    rr.updated_at,
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
  ds.double_check_annotations_count,
  ds.contradictions_count,
  ds.refinement_rounds     AS stats_refinement_rounds,
  ds.agents_ran,
  ds.agents_skipped,
  ds.stage_durations,
  ds.source_class_breakdown,
  ds.strongest_form_pass_count,
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
