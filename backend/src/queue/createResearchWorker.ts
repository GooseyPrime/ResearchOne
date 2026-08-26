import { Worker, type Processor, type WorkerOptions } from 'bullmq';
import { QUEUE_NAMES } from './queues';

export const DEFAULT_RESEARCH_WORKER_CONCURRENCY = 2;
export const MAX_RESEARCH_WORKER_CONCURRENCY = 8;

export function resolveResearchWorkerConcurrency(
  rawValue: string | undefined = process.env.RESEARCH_WORKER_CONCURRENCY,
): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_RESEARCH_WORKER_CONCURRENCY;
  return Math.min(parsed, MAX_RESEARCH_WORKER_CONCURRENCY);
}

/**
 * The construction seam is intentionally small so the production worker and
 * the concurrency regression test exercise the same BullMQ options object.
 */
export function createResearchWorker(
  processor: Processor,
  connection: WorkerOptions['connection'],
): Worker {
  return new Worker(QUEUE_NAMES.RESEARCH, processor, {
    connection,
    concurrency: resolveResearchWorkerConcurrency(),
  });
}
