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

describe('enqueueResearchResumeAfterPlan', () => {
  it('removes a completed resume job before adding a fresh one', async () => {
    const calls: string[] = [];
    const stale = resumeJob('run-1', 'plan-old', 'completed');
    stale.remove = vi.fn(async () => {
      calls.push('remove');
    });
    const fresh = resumeJob('run-1', 'plan-a', 'waiting');
    let getJobCalls = 0;
    const getJob = vi.fn(async () => {
      calls.push('getJob');
      getJobCalls += 1;
      if (getJobCalls === 1) return stale;
      return fresh;
    });
    const add = vi.fn(async () => {
      calls.push('add');
      return {};
    });

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-1', 'plan-a');

    expect(calls).toEqual(['getJob', 'remove', 'add', 'getJob']);
    expect(stale.remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      'research:resume_after_plan',
      { runId: 'run-1', confirmedPlanId: 'plan-a' },
      expect.objectContaining({ jobId: 'run-1:resume_after_plan' })
    );
  });

  it('does not remove a job that is already waiting with the same plan id', async () => {
    const job = resumeJob('run-2', 'plan-b', 'waiting');
    const getJob = vi.fn(async () => job);
    const add = vi.fn(async () => ({}));

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-2', 'plan-b');

    expect(job.remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('replaces a waiting job when confirmed plan id changed after refine', async () => {
    const stale = resumeJob('run-2b', 'plan-old', 'waiting');
    const fresh = resumeJob('run-2b', 'plan-new', 'waiting');
    let getJobCalls = 0;
    const getJob = vi.fn(async () => {
      getJobCalls += 1;
      if (getJobCalls === 1) return stale;
      return fresh;
    });
    const add = vi.fn(async () => ({}));

    await enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-2b', 'plan-new');

    expect(stale.remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalled();
  });

  it('rethrows when add fails and raced job has stale plan id', async () => {
    const getJob = vi.fn(async () => resumeJob('run-3', 'plan-stale', 'active'));
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
    const getJob = vi.fn(async () => {
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

  it('fails final validation when job is missing after add', async () => {
    const getJob = vi.fn(async () => undefined);
    const add = vi.fn(async () => ({}));

    await expect(
      enqueueResearchResumeAfterPlan({ getJob, add } as ResumeQueueLike, 'run-5', 'plan-e')
    ).rejects.toThrow('resume_after_plan_job_missing');
  });
});
