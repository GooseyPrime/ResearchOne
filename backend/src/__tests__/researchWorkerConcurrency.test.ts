import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerConstructor = vi.hoisted(() => vi.fn());

vi.mock('bullmq', () => ({
  Worker: workerConstructor,
}));

vi.mock('../queue/queues', () => ({
  QUEUE_NAMES: { RESEARCH: 'research' },
}));

import {
  DEFAULT_RESEARCH_WORKER_CONCURRENCY,
  MAX_RESEARCH_WORKER_CONCURRENCY,
  createResearchWorker,
  resolveResearchWorkerConcurrency,
} from '../queue/createResearchWorker';

describe('research worker concurrency', () => {
  beforeEach(() => {
    workerConstructor.mockReset();
    delete process.env.RESEARCH_WORKER_CONCURRENCY;
  });

  it('constructs the production research worker with two execution slots by default', () => {
    const processor = vi.fn();
    const connection = { host: 'redis' };

    createResearchWorker(processor, connection);

    expect(DEFAULT_RESEARCH_WORKER_CONCURRENCY).toBe(2);
    expect(workerConstructor).toHaveBeenCalledWith('research', processor, {
      connection,
      concurrency: 2,
    });
  });

  it('accepts a bounded deployment override', () => {
    expect(resolveResearchWorkerConcurrency('4')).toBe(4);
    expect(resolveResearchWorkerConcurrency('999')).toBe(MAX_RESEARCH_WORKER_CONCURRENCY);
  });

  it('falls back safely for missing or invalid overrides', () => {
    expect(resolveResearchWorkerConcurrency(undefined)).toBe(2);
    expect(resolveResearchWorkerConcurrency('0')).toBe(2);
    expect(resolveResearchWorkerConcurrency('not-a-number')).toBe(2);
  });
});
