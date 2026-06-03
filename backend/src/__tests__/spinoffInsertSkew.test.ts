import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../db/pool', () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock('../db/tenantScope', () => ({
  buildOwnershipSql: vi.fn(() => ({ clause: '', params: [] })),
  rejectUnscopedReadOnScopeError: vi.fn((err: unknown) => {
    const e = err as Error & { statusCode?: number };
    e.statusCode = 503;
    throw err;
  }),
}));

import { insertQueuedResearchRunWithLineage } from '../services/research/spinoffService';

const baseParams = {
  runId: 'run-1',
  title: 't',
  query: 'q',
  supplemental: '',
  normalizedOverridesJson: '{}',
  attachmentsJson: '[]',
  engineVersion: 'v2',
  researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
  targetWordCount: 1000,
  userId: 'user-1',
  orgId: null,
  selectedAddonsJson: '[]',
};

describe('insertQueuedResearchRunWithLineage deploy skew', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('fails closed when user_id column is missing for authenticated insert', async () => {
    queryMock.mockRejectedValueOnce({ code: '42703', message: 'column "user_id" does not exist' });

    await expect(insertQueuedResearchRunWithLineage(baseParams)).rejects.toMatchObject({
      code: '42703',
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('falls back when only selected_addons column is missing', async () => {
    queryMock
      .mockRejectedValueOnce({ code: '42703', message: 'column "selected_addons" does not exist' })
      .mockResolvedValueOnce(undefined);

    await insertQueuedResearchRunWithLineage(baseParams);

    expect(queryMock).toHaveBeenCalledTimes(2);
    const secondSql = String(queryMock.mock.calls[1][0]);
    expect(secondSql).not.toContain('selected_addons');
    expect(secondSql).toContain('user_id');
  });
});
