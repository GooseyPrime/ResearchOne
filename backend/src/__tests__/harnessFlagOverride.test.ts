/**
 * A non-admin start request that carries a harness flag override must run
 * exactly as if the field were absent. Asserted through POST /api/research.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (
      req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction
    ) => {
      req.auth = { userId: 'user_not_admin', orgId: null, sessionId: null };
      next();
    },
  };
});

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  checkTierAccessMock: vi.fn(),
  ingestMock: vi.fn(),
  queueAddMock: vi.fn(),
  insertRunMock: vi.fn(),
  creditContextMock: vi.fn(),
}));

vi.mock('../db/pool', () => ({
  query: mocks.queryMock,
  withTransaction: vi.fn(),
  rlsStore: {
    run: <T>(_ctx: unknown, fn: () => T): T => fn(),
    getStore: () => undefined,
  },
}));

vi.mock('../services/tier/tierService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/tier/tierService')>();
  return {
    ...actual,
    checkTierAccess: mocks.checkTierAccessMock,
    getUserTier: vi.fn().mockResolvedValue({ tier: 'pro', current_period_reports_used: 0 }),
  };
});

vi.mock('../services/billing/walletService', () => ({
  getWalletSummary: vi.fn().mockResolvedValue({ balanceCents: 10000 }),
}));

vi.mock('../services/billing/subscriptionService', () => ({
  getUserSubscription: vi.fn().mockResolvedValue({ tier: 'pro', status: 'active' }),
}));

vi.mock('../services/billing/entitlementTier', () => ({
  resolveEffectiveEntitlementTier: vi.fn().mockReturnValue('pro'),
}));

vi.mock('../services/research/researchSupplementalIngest', () => ({
  ingestSupplementalForRun: mocks.ingestMock,
}));

vi.mock('../services/research/spinoffService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/research/spinoffService')>();
  return {
    ...actual,
    insertQueuedResearchRunWithLineage: mocks.insertRunMock,
  };
});

vi.mock('../middleware/creditEnforcement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/creditEnforcement')>();
  return {
    ...actual,
    buildCreditChargeContextForRun: mocks.creditContextMock,
  };
});

vi.mock('../queue/queues', () => ({
  researchQueue: { add: mocks.queueAddMock },
  intellmeDeletionQueue: { add: vi.fn() },
}));

import request from 'supertest';
import testApp from '../api/app';

beforeEach(() => {
  mocks.queryMock.mockReset();
  mocks.checkTierAccessMock.mockReset();
  mocks.ingestMock.mockReset();
  mocks.queueAddMock.mockReset();
  mocks.insertRunMock.mockReset();
  mocks.creditContextMock.mockReset();
  mocks.queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  mocks.checkTierAccessMock.mockResolvedValue({ allowed: true });
  mocks.ingestMock.mockResolvedValue({ urlsQueued: 0, filesQueued: 0, jobIds: [] });
  mocks.queueAddMock.mockResolvedValue(undefined);
  mocks.insertRunMock.mockResolvedValue(undefined);
  mocks.creditContextMock.mockResolvedValue({ ok: true, context: undefined });
});

describe('harness flag override', () => {
  it('ignores a non-admin override and starts the same run', async () => {
    const plain = await request(testApp).post('/api/research').send({ query: 'What year was the treaty signed?' });
    const overridden = await request(testApp)
      .post('/api/research')
      .send({ query: 'What year was the treaty signed?', flagOverrides: { BASELINE_LAYER_ENABLED: true } });

    expect(plain.status).toBe(202);
    expect(overridden.status).toBe(202);
    expect(overridden.body.status).toBe(plain.body.status);
    expect(mocks.insertRunMock).toHaveBeenCalledTimes(2);
    const withoutRunId = (call: { runId?: string }) => {
      const { runId: _runId, ...rest } = call;
      return rest;
    };
    expect(withoutRunId(mocks.insertRunMock.mock.calls[1][0])).toEqual(
      withoutRunId(mocks.insertRunMock.mock.calls[0][0])
    );
    const overrideWrites = mocks.queryMock.mock.calls.filter((call) => String(call[0]).includes('eval_run_overrides'));
    expect(overrideWrites).toHaveLength(0);
    const queueWithoutRun = (payload: { runId?: string }) => {
      const { runId: _runId, ...rest } = payload;
      return rest;
    };
    expect(queueWithoutRun(mocks.queueAddMock.mock.calls[1][1])).toEqual(
      queueWithoutRun(mocks.queueAddMock.mock.calls[0][1])
    );
  });
});
