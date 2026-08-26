import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  getDossierByRunId: vi.fn(),
}));

vi.mock('../middleware/clerkAuth', () => ({
  requireAuth: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    req.auth = { userId: 'user_test', orgId: null, sessionId: null };
    next();
  },
}));

vi.mock('../db/pool', () => ({
  queryOne: mocks.queryOne,
}));

vi.mock('../services/research/dossierReadService', () => ({
  getDossierByRunId: mocks.getDossierByRunId,
}));

vi.mock('../services/planning/accountPreferencesService', () => ({
  bumpPlanConfirmationStreakIfCleanConfirm: vi.fn(),
  resetPlanConfirmationStreak: vi.fn(),
}));

vi.mock('../services/planning/planWriteService', () => ({
  appendPlanRevision: vi.fn(),
  cancelRunAtPlanGate: vi.fn(),
  confirmGatePlan: vi.fn(),
  getGatePlanRowForRun: vi.fn(),
  listPlanRevisionsForRun: vi.fn(),
  markRunRunningAfterPlanConfirm: vi.fn(),
}));

vi.mock('../services/planning/planRefinementService', () => ({
  refinePlan: vi.fn(),
}));

vi.mock('../services/reasoning/v2FallbackResolution', () => ({
  allowFallbackByRoleFromOverrides: vi.fn(),
}));

vi.mock('../services/reasoning/researchOrchestratorNormalize', () => ({
  normalizeRunOverrides: vi.fn(),
}));

vi.mock('../queue/queues', () => ({
  researchQueue: { getJob: vi.fn() },
}));

vi.mock('../queue/researchQueueJobs', () => ({
  researchResumeJobId: vi.fn(),
}));

vi.mock('../utils/researchResumeQueueing', () => ({
  enqueueResearchResumeAfterPlan: vi.fn(),
}));

vi.mock('../services/billing/walletReservations', () => ({
  releaseHold: vi.fn(),
}));

import runsRouter from '../api/routes/runs';

const RUN_ID = '00000000-0000-4000-8000-000000000123';

function appForTest() {
  const app = express();
  app.use(express.json());
  app.use('/api/runs', runsRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return app;
}

beforeEach(() => {
  mocks.queryOne.mockReset();
  mocks.getDossierByRunId.mockReset();
});

describe('GET /api/runs/:runId/plan', () => {
  it('shows the effective gate challenge mode for a legacy paid upgrade', async () => {
    mocks.getDossierByRunId.mockResolvedValue({
      runId: RUN_ID,
      runStatus: 'plan_pending_confirmation',
      plan: {
        planId: 'plan_1',
        intent: 'legacy',
        orchestrationProfile: 'profile',
        planSummary: 'summary',
        planPayload: {
          intent: { id: 'legacy' },
          topicAnalysis: { summary: 'summary' },
          orchestrationProfile: { skepticMode: 'annotate' },
        },
        planStatus: 'pending_confirmation',
        refinementRounds: 0,
      },
    });
    mocks.queryOne
      .mockResolvedValueOnce({
        id: RUN_ID,
        status: 'plan_pending_confirmation',
        resume_job_payload: { addons: ['parallel_search'] },
      })
      .mockResolvedValueOnce({
        selected_addons: ['parallel_search', 'adversarial_twin'],
      });

    const res = await request(appForTest()).get(`/api/runs/${RUN_ID}/plan`);

    expect(res.status).toBe(200);
    expect(res.body.plan.planPayload.orchestrationProfile.skepticMode).toBe('gate');
  });
});
