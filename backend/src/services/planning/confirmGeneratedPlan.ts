import { queryOne } from '../../db/pool';
import { buildOwnershipSql } from '../../db/tenantScope';
import { researchQueue } from '../../queue/queues';
import { researchResumeJobId } from '../../queue/researchQueueJobs';
import { confirmGatePlan, getGatePlanRowForRun, markRunRunningAfterPlanConfirm } from './planWriteService';
import { enqueueResearchResumeAfterPlan } from '../../utils/researchResumeQueueing';
import { logger } from '../../utils/logger';

/** Approve the generated plan as the run's owner. A failure to mark the run running is logged and does not stop approval. */
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
  await enqueueResearchResumeAfterPlan(researchQueue, runId, gatePlan.id);
  const confirmed = await confirmGatePlan({ planId: gatePlan.id, runId });
  if (!confirmed) {
    const already = await queryOne<{ id: string }>(
      `SELECT id FROM research_plans WHERE id = $1::uuid AND run_id = $2::uuid AND status = 'confirmed'`,
      [gatePlan.id, runId]
    );
    if (!already) {
      try {
        const job = await researchQueue.getJob(researchResumeJobId(runId));
        if (job) await job.remove();
      } catch (removeErr) {
        logger.warn('plan_confirm_rollback_job_remove', { runId, err: removeErr });
      }
      throw new Error(`plan for ${runId} could not be confirmed`);
    }
  }
  try {
    await markRunRunningAfterPlanConfirm(runId);
  } catch (markErr) {
    logger.error('plan_confirm_mark_running_failed', { runId, err: markErr });
  }
}
