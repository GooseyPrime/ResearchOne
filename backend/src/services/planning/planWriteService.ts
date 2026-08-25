/**
 * Canonical DB writes for Wave 5.1 research_plans + plan_revisions (Rule 33).
 * Reads for API responses use `v_dossier` via dossierReadService / GET plan route.
 */
import { query, queryOne, withTransaction } from '../../db/pool';
import type { ResearchJobData } from '../reasoning/researchOrchestratorTypes';
import type { PlanPayload } from './planTypes';
import { planSummaryFromPayload } from './planTypes';
import { deriveRunDisplayTitle } from '../research/titleShaping';
import { logger } from '../../utils/logger';

export interface InsertGatePlanResult {
  planId: string;
}


/**
 * Persist the run's human-facing title, derived from the plan just written.
 *
 * Server-side and once, rather than derived by each client. `research_runs.title`
 * is the raw prompt truncated (`api/routes/research.ts`), so every surface that
 * reached for a run's name rendered the prompt: the live run page as a bold
 * `<h1>`, the dossier cards as headlines carrying Markdown `#`. Four consumers
 * of one mapping deriving it four times is Rule 44 T3 by construction.
 *
 * Best-effort by design — a run with no `display_title` reads correctly through
 * the `display_title -> report_title -> run_ref` fallback, so failing the plan
 * write over a cosmetic column would trade a real outcome for a display one.
 * "Best-effort" is not "silent", though: 42703 is the expected pre-migration-057
 * case and is left alone, and everything else is logged (Rule 44 T8 — a job
 * whose failure logs the same as its success has no monitoring value).
 */
async function writeRunDisplayTitle(runId: string, planPayload: PlanPayload): Promise<void> {
  const title = deriveRunDisplayTitle(planPayload.topicAnalysis?.summary);
  if (!title) return;
  try {
    await query(
      `UPDATE research_runs
          SET display_title = $2
        WHERE id = $1::uuid
          AND display_title IS NULL`,
      [runId, title]
    );
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '42703') return; // migration 057 not applied yet
    logger.warn('research_run_display_title_write_failed', {
      runId,
      code,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function insertGateResearchPlan(input: {
  runId: string;
  orgId: string | null;
  userId: string | null;
  intent: string;
  intentConfidence: number;
  planPayload: PlanPayload;
  orchestrationProfile: string | null;
}): Promise<InsertGatePlanResult> {
  const summary = planSummaryFromPayload(input.planPayload);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO research_plans (
       run_id, org_id, user_id, status, intent, intent_confidence,
       plan_payload, plan_summary, orchestration_profile, refinement_rounds
     ) VALUES ($1, $2, $3, 'pending_confirmation', $4, $5, $6::jsonb, $7, $8, 0)
     RETURNING id`,
    [
      input.runId,
      input.orgId,
      input.userId,
      input.intent,
      input.intentConfidence,
      JSON.stringify(input.planPayload),
      summary.slice(0, 8000),
      input.orchestrationProfile,
    ]
  );
  if (!row?.id) throw new Error('insertGateResearchPlan: missing plan id');
  await writeRunDisplayTitle(input.runId, input.planPayload);
  return { planId: row.id };
}

export async function parkRunAwaitingPlanConfirmation(
  runId: string,
  resumePayload: ResearchJobData
): Promise<void> {
  try {
    await query(
      `UPDATE research_runs
          SET status = 'plan_pending_confirmation',
              resume_job_payload = $2::jsonb
        WHERE id = $1`,
      [runId, JSON.stringify({ ...resumePayload, skipPlanConfirmationGate: true })]
    );
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '22P02') {
      await query(
        `UPDATE research_runs SET resume_job_payload = $2::jsonb WHERE id = $1`,
        [runId, JSON.stringify({ ...resumePayload, skipPlanConfirmationGate: true })]
      );
      return;
    }
    throw e;
  }
}

export async function getGatePlanRowForRun(runId: string): Promise<{
  id: string;
  status: string;
  plan_payload: unknown;
  refinement_rounds: number;
  intent: string;
  intent_confidence: string | null;
} | null> {
  return queryOne(
    `SELECT id, status, plan_payload, refinement_rounds, intent, intent_confidence::text AS intent_confidence
       FROM research_plans
      WHERE run_id = $1::uuid
        AND status IN ('pending_confirmation')
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [runId]
  );
}

/** Plan refinement audit trail for a run (Wave 5.4). Caller must enforce run ACL. */
export async function listPlanRevisionsForRun(runId: string): Promise<
  Array<{
    id: string;
    revision_number: number;
    refinement_prompt: string | null;
    diff_summary: string | null;
    created_at: Date;
    created_by: string;
    created_by_email: string | null;
  }>
> {
  return query(
    `SELECT pr.id, pr.revision_number, pr.refinement_prompt, pr.diff_summary, pr.created_at,
            pr.created_by,
            u.email AS created_by_email
       FROM plan_revisions pr
       JOIN research_plans rp ON rp.id = pr.plan_id
       LEFT JOIN users u ON u.id = pr.created_by
      WHERE rp.run_id = $1::uuid
      ORDER BY pr.revision_number ASC`,
    [runId]
  );
}

export async function appendPlanRevision(input: {
  planId: string;
  runId: string;
  createdByUserId: string;
  refinementPrompt: string;
  priorPayload: PlanPayload;
  newPayload: PlanPayload;
  diffSummary: string;
}): Promise<{ revisionNumber: number }> {
  return withTransaction(async (client) => {
    const maxRow = await client.query<{ m: string | null }>(
      `SELECT MAX(revision_number)::text AS m FROM plan_revisions WHERE plan_id = $1::uuid`,
      [input.planId]
    );
    const last = maxRow.rows[0]?.m != null ? Number(maxRow.rows[0].m) : 0;
    const revisionNumber = Number.isFinite(last) ? last + 1 : 1;

    await client.query(
      `INSERT INTO plan_revisions (
         plan_id, revision_number, refinement_prompt, prior_plan_payload, new_plan_payload, diff_summary, created_by
       ) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        input.planId,
        revisionNumber,
        input.refinementPrompt,
        JSON.stringify(input.priorPayload),
        JSON.stringify(input.newPayload),
        input.diffSummary.slice(0, 8000),
        input.createdByUserId,
      ]
    );

    await client.query(
      `UPDATE research_plans
          SET plan_payload = $2::jsonb,
              plan_summary = $3,
              refinement_rounds = refinement_rounds + 1,
              updated_at = NOW()
        WHERE id = $1::uuid`,
      [input.planId, JSON.stringify(input.newPayload), planSummaryFromPayload(input.newPayload).slice(0, 8000)]
    );

    return { revisionNumber };
  });
}

/** Returns true iff exactly one plan row transitioned to confirmed. */
export async function confirmGatePlan(input: {
  planId: string;
  runId: string;
}): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE research_plans
        SET status = 'confirmed',
            confirmed_at = NOW(),
            updated_at = NOW()
      WHERE id = $1::uuid AND run_id = $2::uuid AND status IN ('draft', 'pending_confirmation')
      RETURNING id`,
    [input.planId, input.runId]
  );
  return Boolean(row?.id);
}

export async function markRunRunningAfterPlanConfirm(runId: string): Promise<void> {
  await query(
    `UPDATE research_runs SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1::uuid`,
    [runId]
  );
}

/** Cancel a run parked at the plan gate: terminal `cancelled`, clears resume payload. */
export async function cancelRunAtPlanGate(runId: string): Promise<void> {
  await query(
    `UPDATE research_runs
        SET status = 'cancelled',
            completed_at = NOW(),
            error_message = 'Cancelled at plan confirmation gate',
            resume_job_payload = NULL,
            progress_stage = NULL,
            progress_percent = NULL,
            progress_message = NULL,
            progress_updated_at = NULL,
            updated_at = NOW()
      WHERE id = $1::uuid`,
    [runId]
  );
}

export async function listPlanRevisions(planId: string): Promise<
  Array<{
    id: string;
    revision_number: number;
    refinement_prompt: string | null;
    diff_summary: string | null;
    created_at: Date;
  }>
> {
  return query(
    `SELECT id, revision_number, refinement_prompt, diff_summary, created_at
       FROM plan_revisions
      WHERE plan_id = $1::uuid
      ORDER BY revision_number ASC`,
    [planId]
  );
}
