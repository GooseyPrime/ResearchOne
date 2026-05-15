/** BullMQ job names for the research queue (Wave 5.1 gate + resume). */
export const RESEARCH_JOB_INITIAL = 'research-run';
/** Post–plan-confirmation continuation; same queue as `RESEARCH_JOB_INITIAL`, distinct BullMQ `jobId`. */
export const RESEARCH_JOB_RESUME_AFTER_PLAN = 'research:resume_after_plan';

/** Payload for `RESEARCH_JOB_RESUME_AFTER_PLAN` jobs. */
export interface ResearchResumeAfterPlanJobData {
  runId: string;
  confirmedPlanId: string;
}

/** Stable id for the post–plan-confirmation continuation job (distinct from initial `jobId: runId`). */
export function researchResumeJobId(runId: string): string {
  return `${runId}:resume_after_plan`;
}
