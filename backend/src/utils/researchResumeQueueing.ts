import {
  RESEARCH_JOB_RESUME_AFTER_PLAN,
  researchResumeJobId,
  type ResearchResumeAfterPlanJobData,
} from '../queue/researchQueueJobs';

/** Minimal BullMQ job surface used by plan-confirm resume enqueue (PR #141 / rule 14). */
export type ResumeAfterPlanJobLike = {
  getState: () => Promise<string>;
  remove: () => Promise<void>;
  data: unknown;
};

export type ResumeQueueLike = {
  getJob: (jobId: string) => Promise<ResumeAfterPlanJobLike | undefined>;
  add: (
    name: string,
    data: ResearchResumeAfterPlanJobData,
    opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number } }
  ) => Promise<unknown>;
};

const RUNNABLE_RESUME_STATES = new Set(['waiting', 'delayed', 'prioritized', 'paused']);

function resumeJobPlanId(job: ResumeAfterPlanJobLike | undefined): string | null {
  if (!job) return null;
  const planId = (job.data as ResearchResumeAfterPlanJobData | undefined)?.confirmedPlanId;
  return typeof planId === 'string' ? planId : null;
}

function assertResumeJobQueued(job: ResumeAfterPlanJobLike | undefined, confirmedPlanId: string): void {
  if (!job) {
    throw new Error('resume_after_plan_job_missing');
  }
  const planId = resumeJobPlanId(job);
  if (planId !== confirmedPlanId) {
    throw new Error('resume_after_plan_job_stale_plan_id');
  }
}

/**
 * Enqueue post–plan-confirmation resume work. Removes stale completed/failed jobs
 * that share the dedupe `jobId` so refine → confirm can enqueue fresh payload
 * (same contract as `enqueueResearchRetryJobWithCleanup`).
 */
export async function enqueueResearchResumeAfterPlan(
  queue: ResumeQueueLike,
  runId: string,
  confirmedPlanId: string
): Promise<void> {
  const jobId = researchResumeJobId(runId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    const existingPlanId = resumeJobPlanId(existing);
    if (RUNNABLE_RESUME_STATES.has(state) && existingPlanId === confirmedPlanId) {
      return;
    }
    try {
      await existing.remove();
    } catch {
      // Locked/active: re-fetch below; stale payload must not be treated as success.
    }
  }

  const payload: ResearchResumeAfterPlanJobData = { runId, confirmedPlanId };
  try {
    await queue.add(RESEARCH_JOB_RESUME_AFTER_PLAN, payload, {
      jobId,
      attempts: 8,
      backoff: { type: 'exponential', delay: 750 },
    });
  } catch (queueErr) {
    const raced = await queue.getJob(jobId);
    try {
      assertResumeJobQueued(raced, confirmedPlanId);
    } catch {
      throw queueErr;
    }
  }

  const finalJob = await queue.getJob(jobId);
  assertResumeJobQueued(finalJob, confirmedPlanId);
}
