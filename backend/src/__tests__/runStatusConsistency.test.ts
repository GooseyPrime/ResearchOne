import { describe, it, expect } from 'vitest';

import {
  mapGateStatusToReportRowStatus,
  mapGateStatusToRunStatus,
  type ReportGateStatus,
} from '../services/reasoning/reportGateStatus';
import {
  isCleanRunOutcome,
  resolveRunDisplayState,
  resolveRunTerminalOutcome,
} from '../services/reasoning/runStatusDisplay';

/**
 * Run status must mean the same thing everywhere it is shown.
 *
 * The orchestrator's success path built its run summary with a hardcoded
 * `status: 'completed'`. A run whose gates failed was written to the database as
 * `failed` and simultaneously pushed a green COMPLETED summary to the live view.
 * These tests pin the three surfaces to one another.
 */

const ALL_GATES: ReportGateStatus[] = [
  'completed',
  'completed_degraded',
  'contract_failed',
  'verification_failed',
];

describe('run status consistency across surfaces', () => {
  it('never presents a gated failure as a success', () => {
    for (const gate of ALL_GATES.filter((g) => g !== 'completed')) {
      const runStatus = mapGateStatusToRunStatus(gate);
      expect(runStatus).toBe('failed');
      // The surfaced state must agree with what was written to the database.
      expect(isCleanRunOutcome({ status: runStatus, gateStatus: gate })).toBe(false);
      expect(mapGateStatusToReportRowStatus(gate)).toBe('under_review');
    }
  });

  it('presents a clean pass as a success on every surface', () => {
    expect(mapGateStatusToRunStatus('completed')).toBe('completed');
    expect(mapGateStatusToReportRowStatus('completed')).toBe('finalized');
    expect(isCleanRunOutcome({ status: 'completed', gateStatus: 'completed' })).toBe(true);
  });

  it('reproduces the reported bug: contract_failed must not read as completed', () => {
    // Before the fix the summary carried a hardcoded 'completed' here.
    const surfaced = resolveRunDisplayState({ status: 'failed', gateStatus: 'contract_failed' });
    expect(surfaced.status).toBe('contract_failed');
    expect(surfaced.tone).toBe('failure');
    expect(surfaced.status).not.toBe('completed');
  });
});

/**
 * The orchestrator derives its run row, its run summary, AND its job result
 * from `resolveRunTerminalOutcome`. Testing it is therefore testing all three.
 *
 * The previous version of this suite fed an already-correct state to a helper
 * production never called, so reverting the orchestrator's hardcoded
 * `status: 'completed'` left every test green (Codex P2 review, PR #212).
 */
describe('resolveRunTerminalOutcome — the producer the orchestrator uses', () => {
  it('never reports a gated failure as a clean completion', () => {
    for (const gate of ALL_GATES.filter((g) => g !== 'completed')) {
      const outcome = resolveRunTerminalOutcome(gate);
      expect(outcome.runStatus, gate).toBe('failed');
      expect(outcome.completedCleanly, gate).toBe(false);
      expect(outcome.gateStatus, gate).toBe(gate);
      // A failure the user can read, not a silent one.
      expect(outcome.errorMessage, gate).toBeTruthy();
      expect(outcome.failedStage, gate).toBe('verification');
    }
  });

  it('reports a clean pass as completed, with nothing to explain', () => {
    const outcome = resolveRunTerminalOutcome('completed');
    expect(outcome).toEqual({
      runStatus: 'completed',
      gateStatus: 'completed',
      completedCleanly: true,
      failedStage: null,
      errorMessage: null,
    });
  });

  it('keeps the run row, the summary, and the job result in agreement', () => {
    for (const gate of ALL_GATES) {
      const outcome = resolveRunTerminalOutcome(gate);
      // Run row, via the mapper the orchestrator used before.
      expect(outcome.runStatus, gate).toBe(mapGateStatusToRunStatus(gate));
      // Surfaced summary state.
      expect(
        isCleanRunOutcome({ status: outcome.runStatus, gateStatus: outcome.gateStatus }),
        gate
      ).toBe(outcome.completedCleanly);
      // Report row.
      expect(mapGateStatusToReportRowStatus(gate) === 'finalized', gate).toBe(
        outcome.completedCleanly
      );
    }
  });

  it('gives each gate its own explanation rather than one generic message', () => {
    const messages = ALL_GATES.filter((g) => g !== 'completed').map(
      (g) => resolveRunTerminalOutcome(g).errorMessage
    );
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe('resolveRunDisplayState', () => {
  it('prefers the gate status because it is more specific', () => {
    expect(resolveRunDisplayState({ status: 'failed', gateStatus: 'verification_failed' }).status)
      .toBe('verification_failed');
    expect(resolveRunDisplayState({ status: 'failed', gateStatus: 'contract_failed' }).status)
      .toBe('contract_failed');
  });

  it('does not let a passing gate paint over a later failure', () => {
    // Gates passed, then persistence or billing failed. The run is not green.
    const state = resolveRunDisplayState({ status: 'failed', gateStatus: 'completed' });
    expect(state.status).toBe('failed');
    expect(state.tone).toBe('failure');
  });

  it('treats degraded output as a warning, never a success', () => {
    const state = resolveRunDisplayState({ status: 'failed', gateStatus: 'completed_degraded' });
    expect(state.status).toBe('completed_degraded');
    expect(state.tone).toBe('warning');
    expect(isCleanRunOutcome({ status: 'failed', gateStatus: 'completed_degraded' })).toBe(false);
  });

  it('keeps cancellation neutral rather than alarming', () => {
    expect(resolveRunDisplayState({ status: 'cancelled' }).tone).toBe('neutral');
  });

  it('falls back to the run status when no gate status is present', () => {
    // Runs that failed before reaching the gates carry no gate status.
    expect(resolveRunDisplayState({ status: 'aborted' })).toEqual({
      status: 'aborted',
      tone: 'failure',
    });
    expect(resolveRunDisplayState({ status: 'completed' }).tone).toBe('success');
  });

  it('warns rather than reassures on an unrecognised status', () => {
    // A status this module has not been taught must not default to green.
    expect(resolveRunDisplayState({ status: 'some_future_state' }).tone).toBe('warning');
  });
});
