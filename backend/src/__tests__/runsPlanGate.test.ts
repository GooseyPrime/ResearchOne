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
import { confirmGatePlan, getGatePlanRowForRun, markRunRunningAfterPlanConfirm } from '../services/planning/planWriteService';
import { enqueueResearchResumeAfterPlan } from '../utils/researchResumeQueueing';
import { researchQueue } from '../queue/queues';

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
          orchestrationProfile: { doubleCheckMode: 'annotate' },
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
    expect(res.body.plan.planPayload.orchestrationProfile.doubleCheckMode).toBe('gate');
  });
});

describe('POST /api/runs/:runId/plan/confirm', () => {
  const PLAN_ID = '00000000-0000-4000-8000-000000000456';

  function appWithSignal() {
    const events: Array<{ event: string; data?: unknown }> = [];
    const app = appForTest();
    app.set('io', {
      to: () => ({
        emit: (event: string, data?: unknown) => events.push({ event, data }),
      }),
      emit: (event: string) => events.push({ event }),
    });
    return { app, events };
  }

  beforeEach(() => {
    vi.mocked(getGatePlanRowForRun).mockResolvedValue({
      id: PLAN_ID,
      status: 'pending_confirmation',
      plan_payload: {},
      refinement_rounds: 0,
      intent: 'factual',
      intent_confidence: null,
    });
    vi.mocked(enqueueResearchResumeAfterPlan).mockResolvedValue(undefined);
    vi.mocked(confirmGatePlan).mockReset();
    vi.mocked(confirmGatePlan).mockResolvedValue(true);
    vi.mocked(markRunRunningAfterPlanConfirm).mockResolvedValue(undefined);
    vi.mocked(researchQueue.getJob).mockResolvedValue(undefined as never);
    mocks.queryOne.mockResolvedValue({ id: RUN_ID, status: 'plan_pending_confirmation', refinement_rounds: 0 });
  });

  it('returns success and sends the confirmed signal when marking the run running fails', async () => {
    vi.mocked(markRunRunningAfterPlanConfirm).mockRejectedValue(new Error('status update failed'));
    const { app, events } = appWithSignal();

    const res = await request(app).post(`/api/runs/${RUN_ID}/plan/confirm`).send({ planId: PLAN_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, runId: RUN_ID, planId: PLAN_ID, status: 'resume_queued' });
    expect(events).toContainEqual({ event: 'research:plan_confirmed', data: { runId: RUN_ID, planId: PLAN_ID } });
  });

  it('returns the failed-to-queue error only when the resume cannot be queued', async () => {
    vi.mocked(enqueueResearchResumeAfterPlan).mockRejectedValue(new Error('redis down'));

    const res = await request(appForTest()).post(`/api/runs/${RUN_ID}/plan/confirm`).send({ planId: PLAN_ID });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Failed to queue pipeline resume');
    expect(res.body.detail).toBe('No database changes were made; retry confirm when the queue is available.');
    expect(confirmGatePlan).not.toHaveBeenCalled();
  });

  it('propagates a plan-confirmation database error instead of reporting that nothing changed', async () => {
    vi.mocked(confirmGatePlan).mockRejectedValue(new Error('plan update failed'));

    const res = await request(appForTest()).post(`/api/runs/${RUN_ID}/plan/confirm`).send({ planId: PLAN_ID });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('plan update failed');
    expect(res.body.detail).toBeUndefined();
  });

  it('returns a conflict when the plan cannot be confirmed', async () => {
    vi.mocked(confirmGatePlan).mockResolvedValue(false);
    mocks.queryOne
      .mockResolvedValueOnce({ id: RUN_ID, status: 'plan_pending_confirmation' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const res = await request(appForTest()).post(`/api/runs/${RUN_ID}/plan/confirm`).send({ planId: PLAN_ID });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Plan could not be confirmed (wrong state or plan id)');
  });
});
