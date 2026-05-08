/**
 * Smoke tests S1 / S5 from launch-readiness §15 — Living Reports flow.
 *
 * S1: subscribe → Parallel webhook → revision request created and queued
 *     with the right monitorId / revisionRequestId / webhookEventId, plus
 *     a 'revision_enqueued' event row.
 * S5: webhook replay (same event id) returns 200 idempotent — does NOT
 *     create a duplicate revision request and does NOT enqueue a duplicate
 *     job. The unique constraint on report_monitor_events.webhook_event_id
 *     is the canonical idempotency mechanism.
 *
 * Per Rule 16: these tests MUST fail without the fix. The fix here is the
 * full WO-T integration: signature verify → claim → enqueue → events.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

const mocks = vi.hoisted(() => {
  const PARALLEL_SECRET = 'test_parallel_secret';
  // eventStore mimics the report_monitor_events row enforcement of UNIQUE
  // (webhook_event_id) WHERE webhook_event_id IS NOT NULL.
  const eventStore = new Set<string>();
  return {
    PARALLEL_SECRET,
    eventStore,
    query: vi.fn(),
    queueAdd: vi.fn(),
    createRevisionRequest: vi.fn(),
    deleteRemoteParallelMonitor: vi.fn().mockResolvedValue(undefined),
  };
});

const PARALLEL_SECRET = mocks.PARALLEL_SECRET;

vi.mock('../db/pool', () => ({
  query: mocks.query,
  queryOne: vi.fn(),
}));

vi.mock('../config', () => ({
  config: {
    parallelMonitor: { webhookSecret: mocks.PARALLEL_SECRET },
    parallel: { apiKey: 'pk', baseUrl: 'https://api.parallel.ai', webhookSecret: mocks.PARALLEL_SECRET },
    stripe: {
      secretKey: 'sk_test',
      priceIds: {
        livingReportMonthly: 'price_living_report',
        reverseCitationWatchMonthly: 'price_rcw',
      },
    },
  },
}));

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../queue/queues', () => ({
  livingReportRevisionQueue: { add: mocks.queueAdd },
}));

vi.mock('../services/reasoning/reportRevisionService', () => ({
  createRevisionRequest: mocks.createRevisionRequest,
}));

vi.mock('axios', () => ({
  default: {
    delete: vi.fn().mockResolvedValue({ status: 204 }),
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import parallelWebhookRoutes from '../api/webhooks/parallelMonitor';

type RouterLayer = { route?: { stack: Array<{ handle: RequestHandler }> } };

function getHandler() {
  const router = parallelWebhookRoutes as unknown as { stack: RouterLayer[] };
  const layer = router.stack.find((l) => l.route)?.route?.stack[0]?.handle;
  if (!layer) throw new Error('webhook handler not found');
  return layer;
}

function signedRequest(body: object): { req: Request; raw: Buffer } {
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  const sig = crypto.createHmac('sha256', PARALLEL_SECRET).update(raw).digest('hex');
  const req = {
    headers: { 'x-parallel-signature': sig },
    body: raw,
  } as unknown as Request;
  return { req, raw };
}

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res as Response);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventStore.clear();

  // findMonitorByParallelId — return an active monitor row
  // tryClaimParallelWebhookEvent — INSERT ... ON CONFLICT DO NOTHING RETURNING id
  // updates report_monitors.last_event_at — UPDATE
  // event_kind='revision_enqueued' INSERT
  mocks.query.mockImplementation(async (sqlIn: unknown, params: unknown[] = []) => {
    const sql = typeof sqlIn === 'string' ? sqlIn : '';
    if (sql.includes('FROM report_monitors WHERE parallel_monitor_id')) {
      // findMonitorByParallelId
      return [
        {
          id: 'mon_a',
          report_id: 'rep_a',
          user_id: 'user_a',
          org_id: null,
          monitor_kind: 'living_report',
          parallel_monitor_id: params[0],
          query_def: { kind: 'living_report' },
          status: 'active',
          stripe_subscription_id: 'sub_addon',
          stripe_subscription_item_id: null,
        },
      ];
    }
    if (sql.includes("INSERT INTO report_monitor_events") && sql.includes("'webhook_received'")) {
      // tryClaimParallelWebhookEvent — idempotent on webhook_event_id
      const webhookEventId = params[1] as string;
      if (mocks.eventStore.has(webhookEventId)) {
        return []; // ON CONFLICT DO NOTHING
      }
      mocks.eventStore.add(webhookEventId);
      return [{ id: `evt_row_${webhookEventId}` }];
    }
    if (sql.includes("INSERT INTO report_monitor_events") && sql.includes("'revision_enqueued'")) {
      return [];
    }
    if (sql.includes('UPDATE report_monitors SET last_event_at')) {
      return [];
    }
    return [];
  });

  mocks.createRevisionRequest.mockImplementation(async () => ({
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  }));
  mocks.queueAdd.mockResolvedValue(undefined);
});

describe('Living Reports smoke S1 — subscribe → webhook → revision', () => {
  it('verified webhook event creates a revision request and enqueues a job', async () => {
    const handler = getHandler();
    const eventId = 'evt_parallel_S1_one';
    const { req } = signedRequest({
      id: eventId,
      parallel_monitor_id: 'pm_xyz_123',
      kind: 'change_detected',
    });
    const res = makeRes();

    await handler(req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });

    expect(mocks.createRevisionRequest).toHaveBeenCalledTimes(1);
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);

    const queueArgs = mocks.queueAdd.mock.calls[0];
    expect(queueArgs[0]).toBe('revision');
    const jobData = queueArgs[1] as Record<string, unknown>;
    expect(jobData.monitorId).toBe('mon_a');
    expect(jobData.reportId).toBe('rep_a');
    expect(jobData.webhookEventId).toBe(eventId);
    expect(typeof jobData.revisionRequestId).toBe('string');
    const jobOpts = queueArgs[2] as Record<string, unknown>;
    expect(jobOpts.jobId).toBe(eventId);

    const eventInsertCalls = mocks.query.mock.calls.filter((c) =>
      typeof c[0] === 'string' && (c[0] as string).includes("'revision_enqueued'")
    );
    expect(eventInsertCalls).toHaveLength(1);
  });
});

describe('Living Reports smoke S5 — webhook replay idempotency', () => {
  it('second delivery of the same event_id returns 200 and does not duplicate work', async () => {
    const handler = getHandler();
    const eventId = 'evt_parallel_S5_replay';
    const { req: req1 } = signedRequest({
      id: eventId,
      parallel_monitor_id: 'pm_xyz_123',
      kind: 'change_detected',
    });
    const res1 = makeRes();
    await handler(req1, res1, vi.fn() as NextFunction);
    expect(res1.status).toHaveBeenCalledWith(200);
    expect(res1.json).toHaveBeenCalledWith({ ok: true });

    expect(mocks.createRevisionRequest).toHaveBeenCalledTimes(1);
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);

    // Replay
    const { req: req2 } = signedRequest({
      id: eventId,
      parallel_monitor_id: 'pm_xyz_123',
      kind: 'change_detected',
    });
    const res2 = makeRes();
    await handler(req2, res2, vi.fn() as NextFunction);

    expect(res2.status).toHaveBeenCalledWith(200);
    expect(res2.json).toHaveBeenCalledWith({ ok: true, replayed: true });

    // No duplicate revision request, no duplicate enqueue
    expect(mocks.createRevisionRequest).toHaveBeenCalledTimes(1);
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);
  });

  it('rejects bad signature with 400', async () => {
    const handler = getHandler();
    const raw = Buffer.from(JSON.stringify({ id: 'x', parallel_monitor_id: 'pm_xyz_123' }), 'utf8');
    const req = {
      headers: { 'x-parallel-signature': 'deadbeef' },
      body: raw,
    } as unknown as Request;
    const res = makeRes();
    await handler(req, res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
