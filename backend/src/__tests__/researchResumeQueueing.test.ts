import { describe, expect, it, vi } from 'vitest';
import {
  enqueueResearchResumeAfterPlan,
  type ResumeAfterPlanJobLike,
  type ResumeQueueLike,
} from '../utils/researchResumeQueueing';

function resumeJob(
  runId: string,
  confirmedPlanId: string,
  state = 'waiting'
): ResumeAfterPlanJobLike & { remove: ReturnType<typeof vi.fn> } {
  return {
    remove: vi.fn(async () => undefined),
    getState: vi.fn(async () => state),
    data: { runId, confirmedPlanId },
  };
}

/** BullMQ-safe id is checked first; ignore pre–PR #160 legacy colon lookups in unit mocks. */
function getJobNoLegacy(
  impl: (jobId: string) => Promise<ResumeAfterPlanJobLike | undefined> | ResumeAfterPlanJobLike | undefined
) {
  return vi.fn(async (jobId: string) => {
    if (jobId.endsWith(':resume_after_plan')) return undefined;
    return impl(jobId);
  });
}

describe('enqueueResearchResumeAfterPlan', () => {
  it('enqueues when no prior resume job exists', async () => {
    const added = resumeJob('run-0', 'plan-first', 'waiting');
    const getJob = getJobNoLegacy(async () => undefined);
    const add = vi.fn(async () => added);

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-0', 'plan-first');

    expect(getJob).toHaveBeenCalledTimes(3);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'research:resume_after_plan',
      { runId: 'run-0', confirmedPlanId: 'plan-first' },
      expect.objectContaining({ jobId: 'run-0__resume_after_plan' })
    );
  });

  it('removes a completed resume job before adding a fresh one', async () => {
    const calls: string[] = [];
    const stale = resumeJob('run-1', 'plan-old', 'completed');
    stale.remove = vi.fn(async () => {
      calls.push('remove');
    });
    const fresh = resumeJob('run-1', 'plan-a', 'waiting');
    let getJobCalls = 0;
    const getJob = getJobNoLegacy(async () => {
      calls.push('getJob');
      getJobCalls += 1;
      if (getJobCalls === 1) return stale;
      return fresh;
    });
    const add = vi.fn(async () => {
      calls.push('add');
      return fresh;
    });

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-1', 'plan-a');

    expect(calls).toEqual(['getJob', 'remove', 'add', 'getJob']);
    expect(stale.remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      'research:resume_after_plan',
      { runId: 'run-1', confirmedPlanId: 'plan-a' },
      expect.objectContaining({ jobId: 'run-1__resume_after_plan' })
    );
  });

  it('does not remove a job that is already waiting with the same plan id', async () => {
    const job = resumeJob('run-2', 'plan-b', 'waiting');
    const getJob = getJobNoLegacy(async () => job);
    const add = vi.fn(async () => job);

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-2', 'plan-b');

    expect(job.remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('treats an active job with matching plan id as idempotent success', async () => {
    const job = resumeJob('run-2a', 'plan-active', 'active');
    const getJob = getJobNoLegacy(async () => job);
    const add = vi.fn(async () => job);

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-2a', 'plan-active');

    expect(job.remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('replaces a waiting job when confirmed plan id changed after refine', async () => {
    const stale = resumeJob('run-2b', 'plan-old', 'waiting');
    const fresh = resumeJob('run-2b', 'plan-new', 'waiting');
    let getJobCalls = 0;
    const getJob = getJobNoLegacy(async () => {
      getJobCalls += 1;
      if (getJobCalls === 1) return stale;
      return fresh;
    });
    const add = vi.fn(async () => fresh);

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-2b', 'plan-new');

    expect(stale.remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalled();
  });

  it('rethrows when add fails and raced job has stale plan id', async () => {
    const getJob = getJobNoLegacy(async () => resumeJob('run-3', 'plan-stale', 'active'));
    const add = vi.fn(async () => {
      throw new Error('redis down');
    });

    await expect(
      enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-3', 'plan-c')
    ).rejects.toThrow('redis down');
  });

  it('accepts add race when existing job already has matching plan id', async () => {
    let getJobCalls = 0;
    const raced = resumeJob('run-4', 'plan-d', 'waiting');
    const getJob = getJobNoLegacy(async () => {
      getJobCalls += 1;
      if (getJobCalls === 1) return undefined;
      return raced;
    });
    const add = vi.fn(async () => {
      throw new Error('duplicate job id');
    });

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-4', 'plan-d');

    expect(add).toHaveBeenCalled();
    expect(getJob).toHaveBeenCalledTimes(3);
  });

  it('accepts add race when existing active job has matching plan id', async () => {
    const raced = resumeJob('run-4b', 'plan-d2', 'active');
    const getJob = getJobNoLegacy(async () => raced);
    const add = vi.fn(async () => {
      throw new Error('duplicate job id');
    });

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-4b', 'plan-d2');

    expect(add).not.toHaveBeenCalled();
  });

  it('succeeds when add returns a job but getJob is not yet visible', async () => {
    const added = resumeJob('run-5', 'plan-e', 'waiting');
    const getJob = getJobNoLegacy(async () => undefined);
    const add = vi.fn(async () => added);

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-5', 'plan-e');

    expect(add).toHaveBeenCalledTimes(1);
    expect(getJob).toHaveBeenCalledTimes(3);
  });

  it('fails final validation when job is missing after add and add returned nothing', async () => {
    const getJob = getJobNoLegacy(async () => undefined);
    const add = vi.fn(async () => undefined);

    await expect(
      enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-6', 'plan-f')
    ).rejects.toThrow('resume_after_plan_job_missing');
  });

  it('rejects active job with wrong plan id when remove is locked', async () => {
    const stale = resumeJob('run-7', 'plan-wrong', 'active');
    stale.remove = vi.fn(async () => {
      throw new Error('locked');
    });
    const getJob = getJobNoLegacy(async () => stale);
    const add = vi.fn(async () => {
      throw new Error('duplicate job id');
    });

    await expect(
      enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-7', 'plan-right')
    ).rejects.toThrow('duplicate job id');
  });

  it('removes waiting-children stale job before enqueue', async () => {
    const calls: string[] = [];
    const stale = resumeJob('run-8', 'plan-old', 'waiting-children');
    stale.remove = vi.fn(async () => {
      calls.push('remove');
    });
    const fresh = resumeJob('run-8', 'plan-new', 'waiting');
    let getJobCalls = 0;
    const getJob = getJobNoLegacy(async () => {
      calls.push('getJob');
      getJobCalls += 1;
      if (getJobCalls === 1) return stale;
      return fresh;
    });
    const add = vi.fn(async () => {
      calls.push('add');
      return fresh;
    });

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-8', 'plan-new');

    expect(calls).toEqual(['getJob', 'remove', 'add', 'getJob']);
    expect(stale.remove).toHaveBeenCalled();
  });

  it('retries add once after removing duplicate job id blocker', async () => {
    const calls: string[] = [];
    const stale = resumeJob('run-9', 'plan-stale', 'failed');
    const fresh = resumeJob('run-9', 'plan-new', 'waiting');
    let removeCount = 0;
    stale.remove = vi.fn(async () => {
      calls.push('remove');
      removeCount += 1;
    });
    const getJob = getJobNoLegacy(async () => {
      calls.push('getJob');
      return removeCount >= 2 ? fresh : stale;
    });
    let addCalls = 0;
    const add = vi.fn(async () => {
      addCalls += 1;
      calls.push(`add-${addCalls}`);
      if (addCalls === 1) throw new Error('duplicate job id');
      return fresh;
    });

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-9', 'plan-new');

    expect(calls).toEqual(['getJob', 'remove', 'add-1', 'getJob', 'remove', 'add-2', 'getJob']);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('removes legacy colon dedupe job id before enqueue', async () => {
    const calls: string[] = [];
    const legacy = resumeJob('run-10', 'plan-old', 'failed');
    legacy.remove = vi.fn(async () => {
      calls.push('remove-legacy');
    });
    const fresh = resumeJob('run-10', 'plan-new', 'waiting');
    const getJob = vi.fn(async (id: string) => {
      calls.push(`getJob:${id}`);
      if (id === 'run-10:resume_after_plan') return legacy;
      if (id === 'run-10__resume_after_plan') return undefined;
      return undefined;
    });
    const add = vi.fn(async () => {
      calls.push('add');
      return fresh;
    });

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-10', 'plan-new');

    expect(calls[0]).toBe('getJob:run-10:resume_after_plan');
    expect(calls).toContain('remove-legacy');
    expect(calls).toContain('getJob:run-10__resume_after_plan');
    expect(calls).toContain('add');
    expect(legacy.remove).toHaveBeenCalled();
  });
});
