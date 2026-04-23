import { describe, expect, it, vi } from 'vitest';
import { enqueueResearchRetryJobWithCleanup } from '../utils/researchRetryQueueing';

describe('enqueueResearchRetryJobWithCleanup', () => {
  it('removes existing job with same runId before enqueueing retry', async () => {
    const remove = vi.fn(async () => {});
    const getJob = vi.fn(async () => ({ remove }));
    const add = vi.fn(async () => ({}));

    await enqueueResearchRetryJobWithCleanup({ getJob, add }, 'run-1', { runId: 'run-1', query: 'q' });

    expect(getJob).toHaveBeenCalledWith('run-1');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('research-run', { runId: 'run-1', query: 'q' }, { jobId: 'run-1' });
  });

  it('enqueues retry when no prior job exists', async () => {
    const getJob = vi.fn(async () => undefined);
    const add = vi.fn(async () => ({}));

    await enqueueResearchRetryJobWithCleanup({ getJob, add }, 'run-2', { runId: 'run-2', query: 'q2' });

    expect(getJob).toHaveBeenCalledWith('run-2');
    expect(add).toHaveBeenCalledWith('research-run', { runId: 'run-2', query: 'q2' }, { jobId: 'run-2' });
  });
});
