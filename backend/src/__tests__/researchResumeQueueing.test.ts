import { describe, expect, it, vi } from 'vitest';
import { enqueueResearchResumeAfterPlan } from '../utils/researchResumeQueueing';

describe('enqueueResearchResumeAfterPlan', () => {
  it('removes a completed resume job before adding a fresh one', async () => {
    const calls: string[] = [];
    const remove = vi.fn(async () => {
      calls.push('remove');
    });
    const getState = vi.fn(async () => 'completed');
    const getJob = vi.fn(async () => {
      calls.push('getJob');
      return { remove, getState };
    });
    const add = vi.fn(async () => {
      calls.push('add');
    });

    await enqueueResearchResumeAfterPlan({ getJob, add }, 'run-1', 'plan-a');

    expect(calls).toEqual(['getJob', 'remove', 'add']);
    expect(remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      'research:resume_after_plan',
      { runId: 'run-1', confirmedPlanId: 'plan-a' },
      expect.objectContaining({ jobId: 'run-1:resume_after_plan' })
    );
  });

  it('does not remove a job that is already waiting with the same plan id', async () => {
    const remove = vi.fn(async () => undefined);
    const getState = vi.fn(async () => 'waiting');
    const getJob = vi.fn(async () => ({
      remove,
      getState,
      data: { runId: 'run-2', confirmedPlanId: 'plan-b' },
    }));
    const add = vi.fn(async () => undefined);

    await enqueueResearchResumeAfterPlan({ getJob, add }, 'run-2', 'plan-b');

    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('replaces a waiting job when confirmed plan id changed after refine', async () => {
    const remove = vi.fn(async () => undefined);
    const getState = vi.fn(async () => 'waiting');
    const getJob = vi.fn(async () => ({
      remove,
      getState,
      data: { runId: 'run-2b', confirmedPlanId: 'plan-old' },
    }));
    const add = vi.fn(async () => undefined);

    await enqueueResearchResumeAfterPlan({ getJob, add }, 'run-2b', 'plan-new');

    expect(remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalled();
  });

  it('rethrows when add fails and no job exists after race', async () => {
    const getJob = vi.fn(async () => undefined);
    const add = vi.fn(async () => {
      throw new Error('redis down');
    });

    await expect(
      enqueueResearchResumeAfterPlan({ getJob, add }, 'run-3', 'plan-c')
    ).rejects.toThrow('redis down');
  });
});
