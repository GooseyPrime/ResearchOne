import { queryOne } from '../../db/pool';
import { buildOwnershipSql } from '../../db/tenantScope';
import { researchQueue } from '../../queue/queues';
import { researchResumeJobId } from '../../queue/researchQueueJobs';
import { confirmGatePlan, getGatePlanRowForRun, markRunRunningAfterPlanConfirm } from './planWriteService';
import { enqueueResearchResumeAfterPlan } from '../../utils/researchResumeQueueing';
import { logger } from '../../utils/logger';

/** Queue resume, confirm the generated plan, then mark the run running. Does not edit the plan. */
export async function resumeConfirmedPlan(runId: string, planId: string): Promise<{ ok: boolean; newlyConfirmed: boolean }> {
  await enqueueResearchResumeAfterPlan(researchQueue, runId, planId);
  const confirmed = await confirmGatePlan({ planId, runId });
  if (!confirmed) {
    const already = await queryOne<{ id: string }>(
      `SELECT id FROM research_plans WHERE id = $1::uuid AND run_id = $2::uuid AND status = 'confirmed'`,
      [planId, runId]
    );
    if (!already) {
      try {
        const job = await researchQueue.getJob(researchResumeJobId(runId));
        if (job) await job.remove();
      } catch (removeErr) {
        logger.warn('plan_confirm_rollback_job_remove', { runId, err: removeErr });
      }
      return { ok: false, newlyConfirmed: false };
    }
  }
  await markRunRunningAfterPlanConfirm(runId);
  return { ok: true, newlyConfirmed: confirmed };
}

/** Approve the plan exactly as generated, acting as the run's owner. */
export async function approveGeneratedPlanAsOwner(runId: string): Promise<void> {
  const owner = await queryOne<{ user_id: string | null; org_id: string | null; status: string }>(
    `SELECT user_id, org_id, status::text AS status FROM research_runs WHERE id = $1::uuid`,
    [runId]
  );
  if (!owner?.user_id) throw new Error(`run ${runId} has no owner to approve the plan`);
  const owned = await queryOne<{ id: string }>(
    `SELECT id FROM research_runs WHERE id = $1::uuid AND ${buildOwnershipSql('', 2, 3)}`,
    [runId, owner.user_id, owner.org_id]
  );
  if (!owned) throw new Error(`run ${runId} owner could not open the plan`);
  const gatePlan = await getGatePlanRowForRun(runId);
  if (!gatePlan?.id) throw new Error(`run ${runId} has no generated plan to approve`);
  const confirmed = await resumeConfirmedPlan(runId, gatePlan.id);
  if (!confirmed.ok) throw new Error(`plan for ${runId} could not be confirmed`);
}
