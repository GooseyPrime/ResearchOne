import type { Queue } from 'bullmq';
import {
  RESEARCH_JOB_RESUME_AFTER_PLAN,
  researchResumeJobId,
  type ResearchResumeAfterPlanJobData,
} from '../queue/researchQueueJobs';

type ResumeQueueLike = Pick<Queue, 'getJob' | 'add'>;

const RUNNABLE_RESUME_STATES = new Set(['waiting', 'delayed', 'prioritized', 'paused']);

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
    const existingPlanId =
      typeof (existing.data as ResearchResumeAfterPlanJobData | undefined)?.confirmedPlanId ===
      'string'
        ? (existing.data as ResearchResumeAfterPlanJobData).confirmedPlanId
        : null;
    if (RUNNABLE_RESUME_STATES.has(state) && existingPlanId === confirmedPlanId) {
      return;
    }
    try {
      await existing.remove();
    } catch {
      // Locked/active: another worker owns it; confirm handler may still proceed if job is valid.
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
    if (!raced) {
      throw queueErr;
    }
  }
}
