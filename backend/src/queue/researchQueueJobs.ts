/** BullMQ job names for the research queue (Wave 5.1 gate + resume). */
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
