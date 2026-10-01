/**
 * Admin override rules, asserted through POST /api/research.
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
      req.auth = { userId: 'user_admin', orgId: null, sessionId: null };
      next();
    },
  };
});

vi.mock('../services/auth/adminAllowlist', () => ({
  isAllowlistedAdminUserId: (userId: string | null | undefined) => userId === 'user_admin',
}));

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
  rlsStore: { run: <T>(_ctx: unknown, fn: () => T): T => fn(), getStore: () => undefined },
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
  return { ...actual, insertQueuedResearchRunWithLineage: mocks.insertRunMock };
});

vi.mock('../middleware/creditEnforcement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/creditEnforcement')>();
  return { ...actual, buildCreditChargeContextForRun: mocks.creditContextMock };
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
  mocks.queryMock.mockResolvedValue([]);
  mocks.checkTierAccessMock.mockResolvedValue({ allowed: true });
  mocks.ingestMock.mockResolvedValue({ urlsQueued: 0, filesQueued: 0, jobIds: [] });
  mocks.queueAddMock.mockResolvedValue(undefined);
  mocks.insertRunMock.mockResolvedValue(undefined);
  mocks.creditContextMock.mockResolvedValue({ ok: true, context: undefined });
});

describe('admin harness override through the route', () => {
  it('rejects an unknown flag name', async () => {
    const res = await request(testApp)
      .post('/api/research')
      .send({ query: 'What year was the treaty signed?', flagOverrides: { NOT_A_FLAG: true } });
    expect(res.status).toBe(400);
    expect(mocks.insertRunMock).not.toHaveBeenCalled();
    expect(mocks.queueAddMock).not.toHaveBeenCalled();
  });

  it('does not queue the run when the override cannot be saved', async () => {
    mocks.queryMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes('eval_run_overrides')) throw new Error('save failed');
      return [];
    });
    const res = await request(testApp)
      .post('/api/research')
      .send({ query: 'What year was the treaty signed?', flagOverrides: { BASELINE_LAYER_ENABLED: true } });
    expect(res.status).toBe(500);
    expect(mocks.queueAddMock).not.toHaveBeenCalled();
    const failed = mocks.queryMock.mock.calls.find((call) => String(call[0]).includes("status='failed'"));
    expect(failed?.[1]).toEqual(['flag override could not be saved', expect.any(String)]);
  });
});
