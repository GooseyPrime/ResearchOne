import { describe, expect, it } from 'vitest';
import {
  legacyResearchResumeJobId,
  researchResumeJobId,
} from '../queue/researchQueueJobs';

/** Mirrors BullMQ 5.x `Job.validateOptions` colon rule (repeatable jobs use 3 segments). */
function bullMqColonJobIdError(jobId: string): string | null {
  if (jobId.includes(':') && jobId.split(':').length !== 3) {
    return 'Custom Id cannot contain :';
  }
  return null;
}

describe('researchResumeJobId', () => {
  const runId = 'f4b46ec2-2c42-4ce6-9d0f-183bb795970a';

  it('uses a BullMQ-safe dedupe id without colon', () => {
    const jobId = researchResumeJobId(runId);
    expect(jobId).toBe(`${runId}__resume_after_plan`);
    expect(bullMqColonJobIdError(jobId)).toBeNull();
  });

  it('documents that legacy colon ids fail BullMQ validation', () => {
    const legacyId = legacyResearchResumeJobId(runId);
    expect(legacyId).toBe(`${runId}:resume_after_plan`);
    expect(bullMqColonJobIdError(legacyId)).toBe('Custom Id cannot contain :');
  });
});
