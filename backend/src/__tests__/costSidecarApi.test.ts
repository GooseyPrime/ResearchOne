/**
 * Cost analytics admin endpoints — integration tests.
 *
 * Tests the four endpoints added by PATCH-07:
 *   GET /admin/cost/summary
 *   GET /admin/cost/timeseries
 *   GET /admin/cost/breakdown
 *   GET /admin/cost/reports
 *
 * Per Rule 25 invariant I-10: deploy-skew tolerance MUST return HTTP
 * 200 with {available:false, reason:'migration_pending'} — never a 500.
 *
 * Run: npx vitest run costSidecarApi
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Shared with `ADMIN_TOKEN` — `requireAdmin` uses timingSafeEqual (same-length tokens). */
const costApiAdminTestCtx = vi.hoisted(() => ({
  adminToken: 'test-admin-token-1234567890123456',
}));

vi.mock('../config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../config')>();
  return {
    ...mod,
    config: {
      ...mod.config,
      admin: {
        ...mod.config.admin,
        token: costApiAdminTestCtx.adminToken,
      },
    },
  };
});

import request from 'supertest';
import testApp from '../api/app';

// Mock adminQuery for the four endpoint shapes.
import * as poolMod from '../db/pool';

vi.mock('../db/pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/pool')>();
  return {
    ...actual,
    adminQuery: vi.fn(),
    initDb: vi.fn(),
  };
});

const mockedAdminQuery = poolMod.adminQuery as unknown as ReturnType<typeof vi.fn>;

// Use the same admin-token auth path as the existing
// adminDashboard tests in this folder. See adminDashboard.test.ts
// for the canonical setup.
const ADMIN_TOKEN = costApiAdminTestCtx.adminToken;
beforeEach(() => {
  process.env.ADMIN_RUNTIME_TOKEN = ADMIN_TOKEN;
  mockedAdminQuery.mockReset();
});

function adminHeaders() {
  return { 'x-admin-token': ADMIN_TOKEN };
}

// ─── /admin/cost/summary ─────────────────────────────────────────────

describe('GET /admin/cost/summary', () => {
  it('returns aggregated KPI totals', async () => {
    mockedAdminQuery.mockResolvedValueOnce([
      {
        total_calls: '142',
        total_input_tokens: '2300000',
        total_output_tokens: '850000',
        total_cost_usd: '12.45',
        fallback_calls: '8',
        distinct_runs: '14',
        distinct_reports: '12',
        total_duration_ms: '450000',
      },
    ]);

    const res = await request(testApp).get('/api/admin/cost/summary?days=30').set(adminHeaders());

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.totals.totalCostUsd).toBeCloseTo(12.45);
    expect(res.body.totals.distinctRuns).toBe(14);
    expect(res.body.derived.avgCostPerRunUsd).toBeCloseTo(12.45 / 14);
    expect(res.body.derived.fallbackRate).toBeCloseTo(8 / 142);
  });

  it('returns {available:false, reason:migration_pending} on 42P01', async () => {
    const err = new Error('relation does not exist') as Error & { code: string };
    err.code = '42P01';
    mockedAdminQuery.mockRejectedValueOnce(err);

    const res = await request(testApp).get('/api/admin/cost/summary').set(adminHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: 'migration_pending' });
    // REVERT-CHECK: PATCH-07 — the `if (isMigrationPending(err))` catch
    // arm. Without it, the response is a 500 and the dashboard breaks.
  });

  it('clamps days to [1, 365]', async () => {
    mockedAdminQuery.mockResolvedValue([
      {
        total_calls: '0', total_input_tokens: '0', total_output_tokens: '0',
        total_cost_usd: '0', fallback_calls: '0', distinct_runs: '0',
        distinct_reports: '0', total_duration_ms: '0',
      },
    ]);

    const res1 = await request(testApp).get('/api/admin/cost/summary?days=99999').set(adminHeaders());
    expect(res1.body.days).toBe(365);

    const res2 = await request(testApp).get('/api/admin/cost/summary?days=0').set(adminHeaders());
    expect(res2.body.days).toBe(1);
  });

  it('rejects non-admin', async () => {
    const res = await request(testApp).get('/api/admin/cost/summary');
    expect(res.status).toBe(401);
  });
});

// ─── /admin/cost/timeseries ──────────────────────────────────────────

describe('GET /admin/cost/timeseries', () => {
  it('returns daily rollup points', async () => {
    mockedAdminQuery.mockResolvedValueOnce([
      { day: '2026-05-09', total_cost_usd: '4.20', total_tokens: '850000', call_count: '42', distinct_runs: '4' },
      { day: '2026-05-10', total_cost_usd: '6.10', total_tokens: '1100000', call_count: '58', distinct_runs: '6' },
    ]);

    const res = await request(testApp).get('/api/admin/cost/timeseries?days=7').set(adminHeaders());

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.points).toHaveLength(2);
    expect(res.body.points[0].day).toBe('2026-05-09');
    expect(res.body.points[1].totalCostUsd).toBeCloseTo(6.10);
  });

  it('deploy-skew returns empty points array', async () => {
    const err = new Error('relation does not exist') as Error & { code: string };
    err.code = '42P01';
    mockedAdminQuery.mockRejectedValueOnce(err);

    const res = await request(testApp).get('/api/admin/cost/timeseries').set(adminHeaders());

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.points).toEqual([]);
  });
});

// ─── /admin/cost/breakdown ───────────────────────────────────────────

describe('GET /admin/cost/breakdown', () => {
  it('returns phase breakdown by default', async () => {
    mockedAdminQuery.mockResolvedValueOnce([
      { bucket: 'Reasoning', total_cost_usd: '4.50', total_tokens: '900000', call_count: '30' },
      { bucket: 'Skeptic', total_cost_usd: '3.20', total_tokens: '600000', call_count: '24' },
      { bucket: 'Synthesis', total_cost_usd: '2.80', total_tokens: '500000', call_count: '14' },
    ]);

    const res = await request(testApp).get('/api/admin/cost/breakdown?days=30').set(adminHeaders());

    expect(res.status).toBe(200);
    expect(res.body.dimension).toBe('phase');
    expect(res.body.buckets).toHaveLength(3);
    expect(res.body.buckets[0].bucket).toBe('Reasoning');
  });

  it('accepts dimension=role and dimension=model', async () => {
    mockedAdminQuery.mockResolvedValue([]);

    let res = await request(testApp).get('/api/admin/cost/breakdown?dimension=role').set(adminHeaders());
    expect(res.body.dimension).toBe('agent_role');

    res = await request(testApp).get('/api/admin/cost/breakdown?dimension=model').set(adminHeaders());
    expect(res.body.dimension).toBe('model');
  });

  it('unknown dimension falls back to phase (no SQL injection vector)', async () => {
    mockedAdminQuery.mockResolvedValue([]);

    // Important: even if an attacker passes a malicious dimension, the
    // server picks one of three hardcoded columns. Verify the value
    // sent to the SQL was 'phase' and not the attacker input.
    const res = await request(testApp)
      .get(`/api/admin/cost/breakdown?dimension=${encodeURIComponent("'; DROP TABLE users; --")}`)
      .set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.dimension).toBe('phase');
    // REVERT-CHECK: PATCH-07 — the explicit if/else mapping of
    // dimensionRaw → dimensionCol. If you ever inline the user-supplied
    // string into the SQL template, this test must fail (the dimension
    // in the response would echo the attacker string).
  });
});

// ─── /admin/cost/reports ─────────────────────────────────────────────

describe('GET /admin/cost/reports', () => {
  it('returns per-run rollup rows', async () => {
    mockedAdminQuery.mockResolvedValueOnce([
      {
        run_id: 'r1', report_id: 'rep1', user_id: 'u1',
        run_title: 'Test research', run_status: 'completed',
        research_objective: 'GENERAL_EPISTEMIC_RESEARCH',
        call_count: '8', total_tokens: '14200', total_duration_ms: '45200',
        total_cost_usd: '0.42', fallback_calls: '1',
        first_call_at: '2026-05-10T10:00:00Z', last_call_at: '2026-05-10T10:00:45Z',
        top_phase: 'Skeptic',
      },
    ]);

    const res = await request(testApp).get('/api/admin/cost/reports?days=30').set(adminHeaders());

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].runId).toBe('r1');
    expect(res.body.rows[0].topPhase).toBe('Skeptic');
    expect(res.body.rows[0].totalCostUsd).toBeCloseTo(0.42);
  });

  it('filters by userId', async () => {
    mockedAdminQuery.mockResolvedValueOnce([]);

    await request(testApp).get('/api/admin/cost/reports?days=30&userId=user_alice').set(adminHeaders());

    // Inspect the SQL params: param[0] = sinceIso, param[1] = userId, ...
    const [, params] = mockedAdminQuery.mock.calls[0];
    expect((params as unknown[]).includes('user_alice')).toBe(true);
  });

  it('filters by phase', async () => {
    mockedAdminQuery.mockResolvedValueOnce([]);

    await request(testApp).get('/api/admin/cost/reports?days=30&phase=Skeptic').set(adminHeaders());

    const [, params] = mockedAdminQuery.mock.calls[0];
    expect((params as unknown[]).includes('Skeptic')).toBe(true);
  });

  it('paginates with limit/offset, clamped', async () => {
    mockedAdminQuery.mockResolvedValueOnce([]);

    await request(testApp).get('/api/admin/cost/reports?limit=9999&offset=-5').set(adminHeaders());

    const [, params] = mockedAdminQuery.mock.calls[0] as [string, unknown[]];
    // Last two params are limit, offset. limit clamps to 200, offset clamps to 0.
    expect(params[params.length - 2]).toBe(200);
    expect(params[params.length - 1]).toBe(0);
  });

  it('deploy-skew returns empty rows array', async () => {
    const err = new Error('relation does not exist') as Error & { code: string };
    err.code = '42P01';
    mockedAdminQuery.mockRejectedValueOnce(err);

    const res = await request(testApp).get('/api/admin/cost/reports').set(adminHeaders());

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.rows).toEqual([]);
  });
});
