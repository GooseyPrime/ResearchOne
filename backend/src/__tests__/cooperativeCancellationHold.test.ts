import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  releaseHold: vi.fn(),
}));

vi.mock('../services/billing/walletReservations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/billing/walletReservations')>();
  return {
    ...actual,
    releaseHold: mocks.releaseHold,
  };
});

import { releaseHoldForCooperativeCancellation } from '../services/reasoning/researchOrchestrator';

describe('releaseHoldForCooperativeCancellation', () => {
  beforeEach(() => {
    mocks.releaseHold.mockReset();
  });

  it('releases the hold for a cooperatively cancelled run', async () => {
    mocks.releaseHold.mockResolvedValueOnce(undefined);

    await releaseHoldForCooperativeCancellation('run_1', { holdId: 'hold_1', userId: 'user_1' });

    expect(mocks.releaseHold).toHaveBeenCalledWith('hold_1', 'user_1');
  });

  it('does nothing when no hold exists', async () => {
    await releaseHoldForCooperativeCancellation('run_1', { userId: 'user_1' });
    expect(mocks.releaseHold).not.toHaveBeenCalled();
  });
});
