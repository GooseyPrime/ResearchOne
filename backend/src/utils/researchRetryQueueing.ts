import type { ResearchJobData } from '../services/reasoning/researchOrchestrator';

type RetryQueueLike = {
  getJob: (jobId: string) => Promise<{ remove: () => Promise<void> } | undefined>;
  add: (name: string, data: ResearchJobData, opts: { jobId: string }) => Promise<unknown>;
};

export async function enqueueResearchRetryJobWithCleanup(
  queue: RetryQueueLike,
  runId: string,
  payload: ResearchJobData
): Promise<void> {
  // BullMQ deduplicates by jobId; retries reuse runId as jobId, so remove any stale
  // prior job (failed/completed) first to ensure this enqueue creates a runnable job.
  const existingJob = await queue.getJob(runId);
  if (existingJob) {
    await existingJob.remove();
  }
  await queue.add('research-run', payload, { jobId: runId });
}
