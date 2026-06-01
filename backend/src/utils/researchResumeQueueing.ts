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
  ) => Promise<ResumeAfterPlanJobLike | undefined>;
};

/** BullMQ states where an in-flight job with matching payload is already queued (idempotent confirm). */
const IDEMPOTENT_MATCH_STATES = new Set(['waiting', 'delayed', 'prioritized', 'paused', 'active']);

const RESUME_ADD_OPTS = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 750 },
};

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
    const err = new Error('resume_after_plan_job_stale_plan_id') as Error & {
      existingPlanId?: string | null;
      requestedPlanId: string;
    };
    err.existingPlanId = planId;
    err.requestedPlanId = confirmedPlanId;
    throw err;
  }
}

function isMatchingResumeJob(
  job: ResumeAfterPlanJobLike | undefined,
  state: string,
  confirmedPlanId: string
): boolean {
  return IDEMPOTENT_MATCH_STATES.has(state) && resumeJobPlanId(job) === confirmedPlanId;
}

async function tryRemoveResumeJob(job: ResumeAfterPlanJobLike): Promise<void> {
  try {
    await job.remove();
  } catch {
    // BullMQ: Job.remove() throws on locked/active jobs — caller re-fetches below.
  }
}

async function addResumeJob(
  queue: ResumeQueueLike,
  jobId: string,
  payload: ResearchResumeAfterPlanJobData
): Promise<ResumeAfterPlanJobLike | undefined> {
  return queue.add(RESEARCH_JOB_RESUME_AFTER_PLAN, payload, {
    jobId,
    ...RESUME_ADD_OPTS,
  });
}

/**
 * Enqueue post–plan-confirmation resume work. Removes stale dedupe jobs
 * that share the dedupe `jobId` so refine → confirm can enqueue fresh payload
 * (same contract as `enqueueResearchRetryJobWithCleanup`).
 *
 * BullMQ: `Job.remove()` throws on locked/active jobs — matching `active` jobs are
 * treated as success (idempotent confirm). Final validation uses `add()`'s return
 * value when `getJob(jobId)` is not yet visible. On duplicate `jobId`, force-removes
 * the stale job once and retries `add()` (PR #141 / plan-confirm 503 follow-up).
 */
export async function enqueueResearchResumeAfterPlan(
  queue: ResumeQueueLike,
  runId: string,
  confirmedPlanId: string
): Promise<void> {
  const jobId = researchResumeJobId(runId);
  const payload: ResearchResumeAfterPlanJobData = { runId, confirmedPlanId };

  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (isMatchingResumeJob(existing, state, confirmedPlanId)) {
      return;
    }
    await tryRemoveResumeJob(existing);
  }

  let addedJob: ResumeAfterPlanJobLike | undefined;
  try {
    addedJob = await addResumeJob(queue, jobId, payload);
  } catch (queueErr) {
    const raced = await queue.getJob(jobId);
    if (raced) {
      const racedState = await raced.getState();
      if (isMatchingResumeJob(raced, racedState, confirmedPlanId)) {
        return;
      }
      await tryRemoveResumeJob(raced);
    }
    try {
      addedJob = await addResumeJob(queue, jobId, payload);
    } catch (retryErr) {
      const afterRetry = await queue.getJob(jobId);
      if (afterRetry) {
        const afterState = await afterRetry.getState();
        if (isMatchingResumeJob(afterRetry, afterState, confirmedPlanId)) {
          return;
        }
      }
      try {
        assertResumeJobQueued(afterRetry ?? raced ?? addedJob, confirmedPlanId);
        return;
      } catch {
        throw retryErr ?? queueErr;
      }
    }
  }

  const finalJob = (await queue.getJob(jobId)) ?? addedJob;
  assertResumeJobQueued(finalJob, confirmedPlanId);
}
