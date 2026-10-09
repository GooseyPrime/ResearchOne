/** BullMQ job names for the research queue (the plan-confirmation pass gate + resume). */
export const RESEARCH_JOB_INITIAL = 'research-run';
/** Post–plan-confirmation continuation; same queue as `RESEARCH_JOB_INITIAL`, distinct BullMQ `jobId`. */
export const RESEARCH_JOB_RESUME_AFTER_PLAN = 'research:resume_after_plan';

/** Payload for `RESEARCH_JOB_RESUME_AFTER_PLAN` jobs. */
export interface ResearchResumeAfterPlanJobData {
  runId: string;
  confirmedPlanId: string;
}

/**
 * Stable id for the post–plan-confirmation continuation job (distinct from initial `jobId: runId`).
 *
 * BullMQ 5.x rejects custom `jobId` values that contain `:` unless the id splits into exactly
 * three repeatable-job segments — `${runId}:resume_after_plan` always throws
 * `Custom Id cannot contain :` on `queue.add()` (plan-confirm 503 root cause, PR #160).
 */
export function researchResumeJobId(runId: string): string {
  return `${runId}__resume_after_plan`;
}

/** Pre–PR #160 dedupe id; remove if present so confirm can enqueue after deploy. */
export function legacyResearchResumeJobId(runId: string): string {
  return `${runId}:resume_after_plan`;
}

/**
 * The notice a worker sends when it picks a research job up (RJ-018).
 *
 * It is not a step of the run and carries no percentage: the run's own first
 * step ("starting", 1%) is written by the pipeline a moment later. It carries
 * the server's time so that the two copies a page receives (the run's own
 * channel and the all-pages broadcast) are recognised as one notice. Without a
 * time each copy was stamped by the browser on arrival, so a page showed the
 * start twice, at 0%, and — where the browser's clock ran ahead of the
 * server's — after steps that had happened later.
 */
export interface ResearchStartedNotice {
  stage: 'started';
  runId: string;
  timestamp: string;
  eventType: 'worker_notice';
}

export function researchStartedNotice(runId: string, now: Date = new Date()): ResearchStartedNotice {
  return { stage: 'started', runId, timestamp: now.toISOString(), eventType: 'worker_notice' };
}
