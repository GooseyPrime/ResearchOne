/**
 * Canonical DB writes for Wave 5.1 research_plans + plan_revisions (Rule 33).
 * Reads for API responses use `v_dossier` via dossierReadService / GET plan route.
 */
import { query, queryOne, withTransaction } from '../../db/pool';
import type { ResearchJobData } from '../reasoning/researchOrchestratorTypes';
import type { PlanPayload } from './planTypes';
import { planSummaryFromPayload } from './planTypes';

export interface InsertGatePlanResult {
  planId: string;
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
} | null> {
  return queryOne(
    `SELECT id, status, plan_payload, refinement_rounds, intent
       FROM research_plans
      WHERE run_id = $1::uuid
        AND status IN ('pending_confirmation')
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
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
