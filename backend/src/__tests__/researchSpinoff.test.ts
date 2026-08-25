import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
      req.auth = { userId: 'user_spinoff_test', orgId: null, sessionId: null };
      next();
    },
  };
});

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  checkTierAccessMock: vi.fn(),
  ingestMock: vi.fn(),
  queueAddMock: vi.fn(),
  resolveOwnedMock: vi.fn(),
  buildPriorMock: vi.fn(),
  insertRunMock: vi.fn(),
  getPrefillMock: vi.fn(),
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
    getUserTier: vi.fn().mockResolvedValue({
      tier: 'pro',
      current_period_reports_used: 0,
    }),
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
    resolveOwnedReportForSpinoff: mocks.resolveOwnedMock,
    buildPriorReportContextBlock: mocks.buildPriorMock,
    insertQueuedResearchRunWithLineage: mocks.insertRunMock,
    getSpinoffPrefill: mocks.getPrefillMock,
  };
});

vi.mock('../queue/queues', () => ({
  researchQueue: { add: mocks.queueAddMock },
  intellmeDeletionQueue: { add: vi.fn() },
}));

import request from 'supertest';
import testApp from '../api/app';
import { RUN_CONSUMES_DEEP_QUOTA } from '../config/researchEngine';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  mocks.queryMock.mockReset();
  mocks.checkTierAccessMock.mockReset();
  mocks.ingestMock.mockReset();
  mocks.queueAddMock.mockReset();
  mocks.resolveOwnedMock.mockReset();
  mocks.buildPriorMock.mockReset();
  mocks.insertRunMock.mockReset();
  mocks.getPrefillMock.mockReset();

  mocks.checkTierAccessMock.mockResolvedValue({ allowed: true });
  mocks.ingestMock.mockResolvedValue({ urlsQueued: 0, filesQueued: 0, jobIds: [] });
  mocks.queueAddMock.mockResolvedValue(undefined);
  mocks.insertRunMock.mockResolvedValue(undefined);
  mocks.buildPriorMock.mockResolvedValue('[Spinoff prior report context — report "Test"]]');
  mocks.resolveOwnedMock.mockResolvedValue({
    reportId: REPORT_ID,
    runId: RUN_ID,
    title: 'Test',
    query: 'Parent query',
    supplemental: 'parent supplemental',
    engineVersion: 'v2',
    researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
    targetWordCount: 5000,
    citationStyle: 'apa',
    modelOverrides: null,
    supplementalAttachments: null,
  });
  mocks.getPrefillMock.mockResolvedValue({
    fromReportId: REPORT_ID,
    fromRunId: RUN_ID,
    reportTitle: 'Test',
    query: 'Parent query',
    engineVersion: 'v2',
  });
});

describe('POST /api/research/spinoff', () => {
  it('returns 400 when fromReportId is missing', async () => {
    const res = await request(testApp)
      .post('/api/research/spinoff')
      .send({ query: 'Spinoff query' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fromReportId/i);
    expect(mocks.resolveOwnedMock).not.toHaveBeenCalled();
  });

  it('returns 404 when parent report is not owned', async () => {
    mocks.resolveOwnedMock.mockResolvedValueOnce(null);
    const res = await request(testApp)
      .post('/api/research/spinoff')
      .send({ fromReportId: REPORT_ID, query: 'Spinoff query', engineVersion: 'v2' });
    expect(res.status).toBe(404);
    expect(mocks.insertRunMock).not.toHaveBeenCalled();
  });

  it('writes lineage and merges prior-report context into supplemental', async () => {
    const res = await request(testApp)
      .post('/api/research/spinoff')
      .send({
        fromReportId: REPORT_ID,
        query: 'Spinoff query',
        supplemental: 'User notes',
        engineVersion: 'v2',
      });

    expect(res.status).toBe(202);
    expect(res.body.runId).toBeTruthy();
    // WO-AH-5: the fourth argument used to be `engineVersion === 'v2'`. There
    // is one engine now, so it is the deep-quota classification constant and
    // no longer varies with the request.
    expect(mocks.checkTierAccessMock).toHaveBeenCalledWith(
      'user_spinoff_test',
      'GENERAL_EPISTEMIC_RESEARCH',
      expect.any(Number),
      RUN_CONSUMES_DEEP_QUOTA,
      expect.anything()
    );
    expect(mocks.insertRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lineage: {
          spinoffFromRunId: RUN_ID,
          spinoffFromReportId: REPORT_ID,
        },
        supplemental: expect.stringContaining('[Spinoff prior report context'),
      })
    );
    expect(mocks.queueAddMock).toHaveBeenCalled();
  });
});

describe('GET /api/reports/:id/spinoff/prefill', () => {
  it('returns 404 when report is not accessible', async () => {
    mocks.getPrefillMock.mockResolvedValue(null);
    const res = await request(testApp).get(`/api/reports/${REPORT_ID}/spinoff/prefill`);
    expect(res.status).toBe(404);
  });

  it('returns parent run fields for the spinoff form', async () => {
    const res = await request(testApp).get(`/api/reports/${REPORT_ID}/spinoff/prefill`);
    expect(res.status).toBe(200);
    expect(res.body.fromReportId).toBe(REPORT_ID);
    expect(res.body.fromRunId).toBe(RUN_ID);
    expect(res.body.query).toBe('Parent query');
    expect(res.body.engineVersion).toBe('v2');
  });
});

describe('spinoffService unit helpers', () => {
  it('mergeSupplementalWithPriorContext skips duplicate prior block', async () => {
    const { mergeSupplementalWithPriorContext, SPINOFF_PRIOR_REPORT_MARKER } = await import(
      '../services/research/spinoffService'
    );
    const prior = `${SPINOFF_PRIOR_REPORT_MARKER} — report "X"]]`;
    const merged = mergeSupplementalWithPriorContext(`${prior}\nextra`, prior);
    expect(merged).toBe(`${prior}\nextra`);
    expect(merged.split(SPINOFF_PRIOR_REPORT_MARKER).length - 1).toBe(1);
  });
});
