import { describe, expect, it } from 'vitest';
import { classifyResearchFailureForSocket } from '../utils/researchFailureRouting';

/**
 * Locks in the contract reviewed in PR #39: an orchestrator-thrown error
 * whose `failureMeta.terminal === true` MUST route to `research:aborted`,
 * not `research:failed`. Without this, the realtime socket event briefly
 * presents a resumable failure to the UI even though the row is already
 * terminal `aborted` server-side (Codex P1 / Copilot review).
 */
describe('classifyResearchFailureForSocket', () => {
  const RUN_ID = 'run-1234';

  it('emits research:aborted when failureMeta.terminal === true', () => {
    const decision = classifyResearchFailureForSocket(
      {
        runId: RUN_ID,
        stage: 'retriever_analysis',
        percent: 35,
        message: 'Hugging Face inference failed',
        retryable: true,
        failureMeta: {
          terminal: true,
          retryable: false,
          retryAttempts: 3,
          retryBudget: 3,
          attemptsRemaining: 0,
        },
      },
      RUN_ID
    );

    expect(decision.event).toBe('research:aborted');
    expect(decision.payload.terminal).toBe(true);
    expect(decision.payload.retryable).toBe(false);
    expect(decision.payload.stage).toBe('aborted');
  });

  it('emits research:failed when terminal flag is missing/false', () => {
    const decision = classifyResearchFailureForSocket(
      {
        runId: RUN_ID,
        stage: 'retriever_analysis',
        percent: 35,
        message: 'Hugging Face inference failed',
        retryable: true,
        failureMeta: {
          terminal: false,
          retryable: true,
          retryAttempts: 1,
          retryBudget: 3,
          attemptsRemaining: 2,
        },
      },
      RUN_ID
    );

    expect(decision.event).toBe('research:failed');
    expect(decision.payload.terminal).toBe(false);
    expect(decision.payload.retryable).toBe(true);
    expect(decision.payload.stage).toBe('retriever_analysis');
  });

  it('falls back to provided runId when err.runId is missing', () => {
    const decision = classifyResearchFailureForSocket(
      { message: 'kaboom' },
      RUN_ID
    );
    expect(decision.payload.runId).toBe(RUN_ID);
    expect(decision.event).toBe('research:failed');
  });

  it('treats missing failureMeta as non-terminal', () => {
    const decision = classifyResearchFailureForSocket(
      { runId: RUN_ID, retryable: false, message: 'oops' },
      RUN_ID
    );
    expect(decision.event).toBe('research:failed');
    expect(decision.payload.terminal).toBe(false);
    expect(decision.payload.retryable).toBe(false);
  });
});
