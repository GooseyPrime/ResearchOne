/**
 * A plan revised at the plan screen is written under the switches recorded for
 * its run. Driven through the route: the first live sample was sized as if the
 * switches were off because the revision ran outside them.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  refinePlan: vi.fn(),
  seenInside: [] as Array<{ baseline: boolean; lock: boolean }>,
}));

vi.mock('../middleware/clerkAuth', () => ({
  requireAuth: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    req.auth = { userId: 'user_test', orgId: null, sessionId: null };
    next();
  },
}));
vi.mock('../db/pool', () => ({ queryOne: mocks.queryOne }));
vi.mock('../services/research/dossierReadService', () => ({ getDossierByRunId: vi.fn() }));
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
vi.mock('../services/planning/planRefinementService', () => ({ refinePlan: mocks.refinePlan }));
vi.mock('../services/reasoning/v2FallbackResolution', () => ({ allowFallbackByRoleFromOverrides: vi.fn().mockReturnValue({}) }));
vi.mock('../services/reasoning/researchOrchestratorNormalize', () => ({ normalizeRunOverrides: vi.fn() }));
vi.mock('../queue/queues', () => ({ researchQueue: { getJob: vi.fn() } }));
vi.mock('../queue/researchQueueJobs', () => ({ researchResumeJobId: vi.fn() }));
vi.mock('../utils/researchResumeQueueing', () => ({ enqueueResearchResumeAfterPlan: vi.fn() }));
vi.mock('../services/billing/walletReservations', () => ({ releaseHold: vi.fn() }));

import runsRouter from '../api/routes/runs';
import { baselineLayerEnabled, citationLockEnabled } from '../config';
import { getGatePlanRowForRun } from '../services/planning/planWriteService';

const RUN_ID = '00000000-0000-4000-8000-000000000123';
const PLAN = { intent: { id: 'reference_lookup' }, topicAnalysis: {}, orchestrationProfile: {}, sourceStrategy: {}, outputShape: {}, estimatedCost: {} };

function appForTest() {
  const app = express();
  app.use(express.json());
  app.use('/api/runs', runsRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return app;
}

/** Answers each query by what it asks for. `flags` is what is recorded for the run, or an error to throw. */
function database(flags: Record<string, unknown> | null | Error) {
  mocks.queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('eval_run_overrides')) {
      if (flags instanceof Error) throw flags;
      return flags ? { flags } : null;
    }
    if (sql.includes('resume_job_payload')) return { id: RUN_ID, status: 'plan_pending_confirmation', resume_job_payload: {} };
    if (sql.includes('SELECT query FROM research_runs')) return { query: 'What year?' };
    return null;
  });
}

beforeEach(() => {
  mocks.queryOne.mockReset();
  mocks.refinePlan.mockReset();
  mocks.seenInside.length = 0;
  mocks.refinePlan.mockImplementation(async () => {
    mocks.seenInside.push({ baseline: baselineLayerEnabled(), lock: citationLockEnabled() });
    return { revisedPlan: PLAN, diffSummary: 'changed', intentChange: { detected: false, from: null, to: null, rationale: '' } };
  });
  vi.mocked(getGatePlanRowForRun).mockResolvedValue({ id: 'plan_1', plan_payload: PLAN, refinement_rounds: 0 } as never);
});

const refine = () => request(appForTest()).post(`/api/runs/${RUN_ID}/plan/refine`).send({ refinementInstruction: 'Make it a factual report' });

describe('POST /api/runs/:runId/plan/refine', () => {
  it('revises the plan inside the switches recorded for the run', async () => {
    database({ BASELINE_LAYER_ENABLED: true, CITATION_LOCK_ENABLED: true });
    const res = await refine();
    expect(res.status).toBe(200);
    expect(mocks.seenInside).toEqual([{ baseline: true, lock: true }]);
    // The switches end with the request; nothing is left on for the process.
    expect(baselineLayerEnabled()).toBe(false);
  });

  it('revises under the process settings when nothing is recorded for the run', async () => {
    database(null);
    const res = await refine();
    expect(res.status).toBe(200);
    expect(mocks.seenInside).toEqual([{ baseline: false, lock: false }]);
  });

  it('revises under the process settings on a database that has no table for recorded switches', async () => {
    database(Object.assign(new Error('relation "eval_run_overrides" does not exist'), { code: '42P01' }));
    const res = await refine();
    expect(res.status).toBe(200);
    expect(mocks.seenInside).toEqual([{ baseline: false, lock: false }]);
  });

  it('does not revise the plan when the recorded switches cannot be read', async () => {
    // Revising under the process settings here, while the run later starts under
    // its own switches, would give a plan sized for one and a run under the other.
    database(new Error('connection reset'));
    const res = await refine();
    expect(res.status).toBe(500);
    expect(mocks.refinePlan).not.toHaveBeenCalled();
  });
});
