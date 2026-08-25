/**
 * WO-AH-5 — there is one research engine.
 *
 * Before this change the request body decided which pipeline a run got. A run
 * that did not say `engineVersion: 'v2'` was persisted with `engine_version`
 * NULL, and `resolveReasoningModels` returns `null` for anything but `'v2'`,
 * so every role silently fell back to the environment default model instead of
 * the objective's ensemble. That was a paywall wearing the costume of a
 * setting, and it is why a free-tier report and a paid report were not the
 * same product.
 *
 * These tests hold the line that the engine is no longer an input:
 *  - a request that says nothing about the engine still gets the full one,
 *  - a request that says the wrong thing is not obeyed and is not an error,
 *  - the objective placeholder is written for every run, not only deep ones,
 *  - quota classification comes from one constant, not from the request.
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
      req.auth = { userId: 'user_one_engine_test', orgId: null, sessionId: null };
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
import { RESEARCH_ENGINE_VERSION, RUN_CONSUMES_DEEP_QUOTA } from '../config/researchEngine';

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

async function startResearch(body: Record<string, unknown>) {
  return request(testApp).post('/api/research').send(body);
}

describe('WO-AH-5 — one research engine', () => {
  it('gives a request that never mentions an engine the full one', async () => {
    const res = await startResearch({ query: 'What changed in EU battery regulation this year?' });

    expect(res.status).toBe(202);
    expect(mocks.insertRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ engineVersion: RESEARCH_ENGINE_VERSION })
    );
    expect(mocks.queueAddMock).toHaveBeenCalledWith(
      'research-run',
      expect.objectContaining({ engineVersion: RESEARCH_ENGINE_VERSION }),
      expect.anything()
    );
  });

  it('does not obey a request that asks for the old engine, and does not reject it either', async () => {
    // Old clients and bookmarked forms still send this field. It is dead
    // input: the run is created, and it is created on the one engine. A 400
    // here would break a caller for asking a question that no longer exists.
    const res = await startResearch({ query: 'Compare two suppliers', engineVersion: 'v1' });

    expect(res.status).toBe(202);
    expect(mocks.insertRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ engineVersion: RESEARCH_ENGINE_VERSION })
    );
  });

  it('writes a concrete research objective even when the caller chose none', async () => {
    // The placeholder used to be written only for deep runs, so a Standard run
    // reached the orchestrator with a null objective and no ensemble to resolve.
    const res = await startResearch({ query: 'Where is lithium recycling capacity being built?' });

    expect(res.status).toBe(202);
    expect(mocks.insertRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ researchObjective: 'GENERAL_EPISTEMIC_RESEARCH' })
    );
    // ...but it is still marked as not the caller's choice, so intent
    // classification is free to replace it.
    expect(mocks.queueAddMock).toHaveBeenCalledWith(
      'research-run',
      expect.objectContaining({ researchObjectiveExplicit: false }),
      expect.anything()
    );
  });

  it('keeps an objective the caller did choose, and marks it as chosen', async () => {
    const res = await startResearch({
      query: 'Patent whitespace in solid-state electrolytes',
      researchObjective: 'PATENT_GAP_ANALYSIS',
    });

    expect(res.status).toBe(202);
    expect(mocks.queueAddMock).toHaveBeenCalledWith(
      'research-run',
      expect.objectContaining({
        researchObjective: 'PATENT_GAP_ANALYSIS',
        researchObjectiveExplicit: true,
      }),
      expect.anything()
    );
  });

  it('classifies deep-quota consumption from one constant, not from the request', async () => {
    await startResearch({ query: 'A', engineVersion: 'v2' });
    await startResearch({ query: 'B' });

    for (const call of mocks.checkTierAccessMock.mock.calls) {
      expect(call[3]).toBe(RUN_CONSUMES_DEEP_QUOTA);
    }
    expect(mocks.checkTierAccessMock).toHaveBeenCalledTimes(2);
  });
});
