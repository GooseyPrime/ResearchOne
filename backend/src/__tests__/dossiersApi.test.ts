/**
 * Dossier API — validates routing, auth gate, UUID validation, and delegation
 * to dossierReadService (Rule 32).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
      req.auth = { userId: 'user_test', orgId: null, sessionId: null };
      next();
    },
  };
});

const dossierServiceMocks = vi.hoisted(() => ({
  listDossiers: vi.fn(),
  getDossierById: vi.fn(),
  getDossierRequest: vi.fn(),
  getDossierPlan: vi.fn(),
  getDossierReportLink: vi.fn(),
  getDossierStats: vi.fn(),
}));

vi.mock('../services/research/dossierReadService', () => dossierServiceMocks);

import request from 'supertest';
import testApp from '../api/app';

const RUN_ID = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  dossierServiceMocks.listDossiers.mockReset();
  dossierServiceMocks.getDossierById.mockReset();
  dossierServiceMocks.getDossierRequest.mockReset();
  dossierServiceMocks.getDossierPlan.mockReset();
  dossierServiceMocks.getDossierReportLink.mockReset();
  dossierServiceMocks.getDossierStats.mockReset();
});

describe('GET /api/dossiers', () => {
  it('returns list payload from dossierReadService', async () => {
    dossierServiceMocks.listDossiers.mockResolvedValueOnce({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    const res = await request(testApp).get('/api/dossiers');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(dossierServiceMocks.listDossiers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 }),
      expect.objectContaining({ userId: 'user_test', orgId: null }),
    );
  });

  it('returns 400 on invalid page', async () => {
    const res = await request(testApp).get('/api/dossiers?page=0');
    expect(res.status).toBe(400);
    expect(dossierServiceMocks.listDossiers).not.toHaveBeenCalled();
  });
});

describe('GET /api/dossiers/:id', () => {
  it('returns 400 when id is not a UUID', async () => {
    const res = await request(testApp).get('/api/dossiers/not-a-uuid');
    expect(res.status).toBe(400);
    expect(dossierServiceMocks.getDossierById).not.toHaveBeenCalled();
  });

  it('returns 404 when service returns null', async () => {
    dossierServiceMocks.getDossierById.mockResolvedValueOnce(null);
    const res = await request(testApp).get(`/api/dossiers/${RUN_ID}`);
    expect(res.status).toBe(404);
    expect(dossierServiceMocks.getDossierById).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({ userId: 'user_test' }),
    );
  });

  it('returns dossier JSON when found', async () => {
    dossierServiceMocks.getDossierById.mockResolvedValueOnce({
      dossierId: RUN_ID,
      runId: RUN_ID,
      runStatus: 'completed',
      request: { query: 'q', supplemental: null, supplementalAttachments: null, createdAt: '2020-01-01T00:00:00.000Z' },
      plan: {
        planId: null,
        intent: 'legacy',
        planSummary: null,
        planPayload: {},
        planStatus: 'legacy',
        refinementRounds: 0,
      },
      report: { reportId: null, title: null, status: null, finalizedAt: null },
      stats: {
        totalDurationMs: null,
        tokensInput: null,
        tokensOutput: null,
        sourcesRetrievedCount: null,
        sourcesCitedCount: null,
        citationDensity: null,
        skepticAnnotationsCount: null,
        contradictionsCount: null,
        refinementRounds: null,
        agentsRan: null,
        agentsSkipped: null,
        stageDurations: null,
        modelsUsed: null,
        estimatedCostCents: null,
        actualCostCents: null,
        reportEvidenceTierSummary: null,
      },
    });

    const res = await request(testApp).get(`/api/dossiers/${RUN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.dossierId).toBe(RUN_ID);
  });
});
