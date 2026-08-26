import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getJob: vi.fn(),
  markRunCancelled: vi.fn(),
  releaseHoldForCancelledRun: vi.fn(),
  releaseHold: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../middleware/clerkAuth', () => ({
  requireAuth: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    req.auth = { userId: 'user_test', orgId: null, sessionId: null };
    next();
  },
}));

vi.mock('../db/pool', () => ({
  query: mocks.query,
}));

vi.mock('../queue/queues', () => ({
  researchQueue: { getJob: mocks.getJob, add: vi.fn() },
  intellmeDeletionQueue: { add: vi.fn() },
}));

vi.mock('../services/researchCancellation', () => ({
  markRunCancelled: mocks.markRunCancelled,
}));

vi.mock('../services/billing/releaseRunHold', () => ({
  releaseHoldForCancelledRun: mocks.releaseHoldForCancelledRun,
}));

vi.mock('../services/billing/walletReservations', () => ({
  releaseHold: mocks.releaseHold,
}));

vi.mock('../utils/logger', () => ({
  logger: {
    warn: mocks.loggerWarn,
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import researchRouter from '../api/routes/research';

function appForTest() {
  const app = express();
  app.use(express.json());
  app.use('/api/research', researchRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return app;
}

beforeEach(() => {
  mocks.query.mockReset();
  mocks.getJob.mockReset();
  mocks.markRunCancelled.mockReset();
  mocks.releaseHoldForCancelledRun.mockReset();
  mocks.releaseHold.mockReset();
  mocks.loggerWarn.mockReset();
});

describe('POST /api/research/:id/cancel', () => {
  it('falls back to cooperative cancellation when queued job removal loses the race', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 'run_1', status: 'queued' }]);
    mocks.getJob.mockResolvedValueOnce({
      data: { creditChargeContext: { holdId: 'hold_1', userId: 'user_1' } },
      remove: vi.fn().mockRejectedValue(new Error('Job is locked')),
    });
    mocks.markRunCancelled.mockResolvedValueOnce(undefined);

    const res = await request(appForTest()).post('/api/research/run_1/cancel').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'cancellation_requested' });
    expect(mocks.markRunCancelled).toHaveBeenCalledWith('run_1');
    expect(mocks.releaseHold).not.toHaveBeenCalled();
    expect(mocks.releaseHoldForCancelledRun).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('logs when a queued cancellation cannot read hold context from the queue job', async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: 'run_1', status: 'queued' }])
      .mockResolvedValueOnce([]);
    mocks.getJob.mockResolvedValueOnce(null);
    mocks.releaseHoldForCancelledRun.mockResolvedValueOnce(undefined);

    const res = await request(appForTest()).post('/api/research/run_1/cancel').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'cancelled' });
    expect(mocks.loggerWarn).toHaveBeenCalledWith('queued_cancel_missing_hold_context', { runId: 'run_1' });
    expect(mocks.releaseHoldForCancelledRun).toHaveBeenCalledWith('run_1');
  });

  it('does not re-read the removed job when the captured queue context is incomplete', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mocks.query
      .mockResolvedValueOnce([{ id: 'run_1', status: 'queued' }])
      .mockResolvedValueOnce([]);
    mocks.getJob.mockResolvedValueOnce({
      data: { creditChargeContext: { userId: 'user_1' } },
      remove,
    });

    const res = await request(appForTest()).post('/api/research/run_1/cancel').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'cancelled' });
    expect(remove).toHaveBeenCalled();
    expect(mocks.releaseHold).not.toHaveBeenCalled();
    expect(mocks.releaseHoldForCancelledRun).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith('queued_cancel_incomplete_hold_context', { runId: 'run_1' });
  });
});
