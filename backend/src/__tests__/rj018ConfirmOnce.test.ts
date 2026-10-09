/**
 * RJ-018 item 5. One confirmation starts one run. A second confirmation (a
 * second click, a second tab, or two requests that cross) is answered in plain
 * words and starts nothing; and the notice a worker sends when it picks a run
 * up carries the server's time, so a page that receives it twice shows it once.
 */
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryOne: vi.fn(), query: vi.fn() }));

vi.mock('../middleware/clerkAuth', () => ({
  requireAuth: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    req.auth = { userId: 'user_test', orgId: null, sessionId: null };
    next();
  },
}));
vi.mock('../db/pool', () => ({ queryOne: mocks.queryOne, query: mocks.query }));
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
vi.mock('../services/planning/planRefinementService', () => ({ refinePlan: vi.fn() }));
vi.mock('../services/reasoning/v2FallbackResolution', () => ({ allowFallbackByRoleFromOverrides: vi.fn() }));
vi.mock('../services/reasoning/researchOrchestratorNormalize', () => ({ normalizeRunOverrides: vi.fn() }));
vi.mock('../queue/queues', () => ({ researchQueue: { getJob: vi.fn() } }));
vi.mock('../utils/researchResumeQueueing', () => ({ enqueueResearchResumeAfterPlan: vi.fn() }));
vi.mock('../services/billing/walletReservations', () => ({ releaseHold: vi.fn() }));

import runsRouter, { PLAN_ALREADY_CONFIRMED, PLAN_NOT_WAITING_MESSAGE, planConfirmRepeatAnswer } from '../api/routes/runs';
import { confirmGatePlan, getGatePlanRowForRun, markRunRunningAfterPlanConfirm } from '../services/planning/planWriteService';
import { bumpPlanConfirmationStreakIfCleanConfirm } from '../services/planning/accountPreferencesService';
import { enqueueResearchResumeAfterPlan } from '../utils/researchResumeQueueing';
import { researchStartedNotice } from '../queue/researchQueueJobs';

const RUN_ID = '00000000-0000-4000-8000-000000000123';
const PLAN_ID = '00000000-0000-4000-8000-000000000456';

function appWithSignal() {
  const events: string[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/runs', runsRouter);
  app.set('io', { to: () => ({ emit: (event: string) => events.push(event) }), emit: (event: string) => events.push(event) });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return { app, events };
}

const confirm = (app: express.Express) => request(app).post(`/api/runs/${RUN_ID}/plan/confirm`).send({ planId: PLAN_ID });

beforeEach(() => {
  mocks.queryOne.mockReset();
  vi.mocked(getGatePlanRowForRun).mockReset().mockResolvedValue({ id: PLAN_ID, status: 'pending_confirmation', plan_payload: {}, refinement_rounds: 0, intent: 'factual', intent_confidence: null });
  vi.mocked(enqueueResearchResumeAfterPlan).mockReset().mockResolvedValue(undefined);
  vi.mocked(confirmGatePlan).mockReset().mockResolvedValue(true);
  vi.mocked(markRunRunningAfterPlanConfirm).mockReset().mockResolvedValue(undefined);
  vi.mocked(bumpPlanConfirmationStreakIfCleanConfirm).mockReset();
});

describe('confirming a plan twice', () => {
  it('the first confirmation queues the run once and announces it', async () => {
    mocks.queryOne.mockResolvedValue({ id: RUN_ID, status: 'plan_pending_confirmation', refinement_rounds: 0 });
    const { app, events } = appWithSignal();
    const res = await confirm(app);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resume_queued');
    expect(enqueueResearchResumeAfterPlan).toHaveBeenCalledTimes(1);
    expect(markRunRunningAfterPlanConfirm).toHaveBeenCalledTimes(1);
    expect(events).toContain('research:plan_confirmed');
  });

  it.each(['running', 'completed'])('a second confirmation of a run that is %s is a plain success and starts nothing', async (status) => {
    mocks.queryOne.mockResolvedValue({ id: RUN_ID, status });
    const { app, events } = appWithSignal();
    const res = await confirm(app);
    // On main: 400 "Run is not awaiting plan confirmation (status=running)".
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, runId: RUN_ID, planId: PLAN_ID, ...PLAN_ALREADY_CONFIRMED });
    expect(res.body.message).toBe('This plan is already confirmed. The research has started, so there is nothing more to do.');
    expect(JSON.stringify(res.body)).not.toMatch(/status=|plan_pending_confirmation|not awaiting/);
    expect(enqueueResearchResumeAfterPlan).not.toHaveBeenCalled();
    expect(confirmGatePlan).not.toHaveBeenCalled();
    expect(markRunRunningAfterPlanConfirm).not.toHaveBeenCalled();
    expect(bumpPlanConfirmationStreakIfCleanConfirm).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it.each(['cancelled', 'failed', 'aborted', 'queued'])('a run that is %s cannot be confirmed, and the reason is in plain words', async (status) => {
    mocks.queryOne.mockResolvedValue({ id: RUN_ID, status });
    const res = await confirm(appWithSignal().app);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: PLAN_NOT_WAITING_MESSAGE, code: 'plan_not_waiting' });
    expect(res.body.error).not.toMatch(/status=|_/);
    expect(enqueueResearchResumeAfterPlan).not.toHaveBeenCalled();
  });

  it('two confirmations that cross: the one that lost the race marks nothing, counts nothing and announces nothing', async () => {
    vi.mocked(confirmGatePlan).mockResolvedValue(false);
    mocks.queryOne
      .mockResolvedValueOnce({ id: RUN_ID, status: 'plan_pending_confirmation' }) // both saw the run waiting
      .mockResolvedValueOnce(undefined) // the plan is no longer pending: the other request confirmed it
      .mockResolvedValueOnce({ id: PLAN_ID }) // and it is confirmed
      .mockResolvedValueOnce({ id: RUN_ID, status: 'running' }); // and the run has started
    const { app, events } = appWithSignal();
    const res = await confirm(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, runId: RUN_ID, planId: PLAN_ID, ...PLAN_ALREADY_CONFIRMED });
    // On main this request marked the run running a second time and announced a second confirmation.
    expect(markRunRunningAfterPlanConfirm).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('a confirmation that was cut off after the plan was saved can still be finished', async () => {
    vi.mocked(confirmGatePlan).mockResolvedValue(false);
    mocks.queryOne
      .mockResolvedValueOnce({ id: RUN_ID, status: 'plan_pending_confirmation' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: PLAN_ID })
      .mockResolvedValueOnce({ id: RUN_ID, status: 'plan_pending_confirmation' }); // still waiting: nobody finished it
    const res = await confirm(appWithSignal().app);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resume_queued');
    expect(markRunRunningAfterPlanConfirm).toHaveBeenCalledTimes(1);
  });

  it('the rule itself', () => {
    expect(planConfirmRepeatAnswer('running')).toBe(PLAN_ALREADY_CONFIRMED);
    expect(planConfirmRepeatAnswer('completed')).toBe(PLAN_ALREADY_CONFIRMED);
    for (const status of ['cancelled', 'failed', 'aborted', 'queued', '']) expect(planConfirmRepeatAnswer(status)).toBeNull();
  });
});

describe('moving a run from waiting to running', () => {
  it('only moves a run that is still waiting at its plan', () => {
    const source = readFileSync(join(__dirname, '..', 'services', 'planning', 'planWriteService.ts'), 'utf8');
    const statement = source.slice(source.indexOf('export async function markRunRunningAfterPlanConfirm'));
    expect(statement.slice(0, statement.indexOf('}\n'))).toMatch(/WHERE id = \$1::uuid\s+AND status = 'plan_pending_confirmation'/);
  });
});

describe('the notice a worker sends when it picks a run up', () => {
  it('carries the run, the server’s time, and no percentage', () => {
    const at = new Date('2026-10-09T13:15:07.250Z');
    expect(researchStartedNotice(RUN_ID, at)).toEqual({ stage: 'started', runId: RUN_ID, timestamp: '2026-10-09T13:15:07.250Z', eventType: 'worker_notice' });
    expect(researchStartedNotice(RUN_ID)).not.toHaveProperty('percent');
    expect(Number.isNaN(Date.parse(researchStartedNotice(RUN_ID).timestamp))).toBe(false);
  });

  it('is what both kinds of research job send; neither sends a start with no time', () => {
    const workers = readFileSync(join(__dirname, '..', 'queue', 'workers.ts'), 'utf8');
    expect(workers.match(/'research:progress', researchStartedNotice\(/g)?.length).toBe(2);
    expect(workers).not.toMatch(/\{\s*stage:\s*'started'/);
  });
});
