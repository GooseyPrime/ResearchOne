/**
 * Cancelling a run gives the money back (Codex P1, PR #229).
 *
 * A run that costs wallet money places a hold before it starts. Nothing in the
 * product could cancel a run, so nothing released the hold on cancellation —
 * the money sat in `reserved_cents` until the hold aged out after thirty
 * minutes and the hourly reaper noticed. WO-AH puts a Cancel button on the run
 * workspace, which turns a dormant gap into one a user hits by pressing the
 * button we gave them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  getJobMock: vi.fn(),
  releaseHoldMock: vi.fn(),
}));

vi.mock('../db/pool', () => ({
  query: mocks.queryMock,
  queryOne: mocks.queryOneMock,
  withTransaction: vi.fn(),
  rlsStore: { run: <T>(_c: unknown, fn: () => T): T => fn(), getStore: () => undefined },
}));

vi.mock('../queue/queues', () => ({
  researchQueue: { getJob: mocks.getJobMock, add: vi.fn() },
  intellmeDeletionQueue: { add: vi.fn() },
}));

vi.mock('../services/billing/walletReservations', () => ({
  releaseHold: mocks.releaseHoldMock,
  consumeHold: vi.fn(),
}));

import { releaseHoldForCancelledRun } from '../services/billing/releaseRunHold';

const RUN_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  mocks.queryMock.mockReset();
  mocks.queryOneMock.mockReset();
  mocks.getJobMock.mockReset();
  mocks.releaseHoldMock.mockReset();
  mocks.queryMock.mockResolvedValue([]);
  mocks.getJobMock.mockResolvedValue(null);
  mocks.releaseHoldMock.mockResolvedValue(undefined);
});

describe('releaseHoldForCancelledRun', () => {
  it("releases a queued run's hold, which lives on its queue job", async () => {
    mocks.getJobMock.mockResolvedValue({
      data: { creditChargeContext: { type: 'wallet', holdId: 'hold_1', userId: 'user_1' } },
    });

    await releaseHoldForCancelledRun(RUN_ID);

    expect(mocks.releaseHoldMock).toHaveBeenCalledWith('hold_1', 'user_1');
  });

  it("releases a plan-gate run's hold, which lives in resume_job_payload", async () => {
    mocks.queryMock.mockResolvedValue([
      { resume_job_payload: { creditChargeContext: { type: 'wallet', holdId: 'hold_2', userId: 'user_2' } } },
    ]);

    await releaseHoldForCancelledRun(RUN_ID);

    expect(mocks.releaseHoldMock).toHaveBeenCalledWith('hold_2', 'user_2');
  });

  it('releases a subscription run whose hold covers a paid add-on surcharge', async () => {
    // Keyed on the hold, not on `type === 'wallet'`. A subscription run with a
    // paid add-on holds money too, and a wallet-only test would pass while
    // exactly those stayed stranded.
    mocks.getJobMock.mockResolvedValue({
      data: { creditChargeContext: { type: 'subscription', holdId: 'hold_3', userId: 'user_3' } },
    });

    await releaseHoldForCancelledRun(RUN_ID);

    expect(mocks.releaseHoldMock).toHaveBeenCalledWith('hold_3', 'user_3');
  });

  it('does nothing when the run never held any money', async () => {
    mocks.getJobMock.mockResolvedValue({ data: { creditChargeContext: undefined } });

    await releaseHoldForCancelledRun(RUN_ID);

    expect(mocks.releaseHoldMock).not.toHaveBeenCalled();
  });

  it('never lets a failed release stop the cancellation', async () => {
    mocks.getJobMock.mockResolvedValue({
      data: { creditChargeContext: { holdId: 'hold_4', userId: 'user_4' } },
    });
    mocks.releaseHoldMock.mockRejectedValue(new Error('wallet unavailable'));

    await expect(releaseHoldForCancelledRun(RUN_ID)).resolves.toBeUndefined();
  });
});
