# PATCH 07 — `admin.ts`: Add cost analytics endpoints

**File:** `backend/src/api/routes/admin.ts`
**Why:** Surface `agent_executions` + `report_cost_summary` to the
admin dashboard. Four endpoints — summary, timeseries, breakdown,
reports — supporting the KPI cards, chart, and filtered table on
`CostAnalytics.tsx`.

**Behavioral guarantee:** All endpoints are behind the existing
`router.use(requireAdmin)` guard at line 23 — no new auth surface.
All queries use `adminQuery` (bypasses RLS) following the
`/telemetry/runs` and `/audit-log` precedent. All endpoints catch
Postgres `42P01` and return `{available: false, reason: 'migration_pending'}`
with HTTP 200 per Rule 25 invariant I-6.

---

## Step 1 — Add at the BOTTOM of `admin.ts`, immediately before `export default router;`

The current end of file (line 506–539) looks like:

```ts
router.get('/audit-log', async (req, res, next) => {
  // ... ~30 lines ...
});

export default router;
```

**Insert the following block between the `/audit-log` handler and the
final `export default router;`:**

```ts
// ─── Admin Dashboard: Cost Analytics ─────────────────────────────────
//
// Backed by migration 030 (agent_executions + model_pricing +
// report_cost_summary view). All endpoints tolerate the migration not
// having applied (Rule 25 I-6) by returning {available:false, reason:
// 'migration_pending'} with HTTP 200 instead of 500.
//
// Read-only — these endpoints never mutate cost data. Pricing edits
// are SQL-only for the initial iteration (see ADR).

interface CostQueryWindow {
  days: number;
  sinceIso: string;
}

function parseCostWindow(req: import('express').Request): CostQueryWindow {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
  const since = new Date();
  since.setDate(since.getDate() - days);
  return { days, sinceIso: since.toISOString() };
}

function isMigrationPending(err: unknown): boolean {
  return (err as { code?: string })?.code === '42P01';
}

// 1. Summary — KPI scorecards at top of dashboard.
router.get('/cost/summary', async (req, res, next) => {
  try {
    const { days, sinceIso } = parseCostWindow(req);
    const rows = await adminQuery<{
      total_calls: string;
      total_input_tokens: string;
      total_output_tokens: string;
      total_cost_usd: string;
      fallback_calls: string;
      distinct_runs: string;
      distinct_reports: string;
      total_duration_ms: string;
    }>(
      `SELECT
         COUNT(*)::text                                          AS total_calls,
         COALESCE(SUM(input_tokens), 0)::text                    AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0)::text                   AS total_output_tokens,
         COALESCE(SUM(calculated_cost_usd), 0)::text             AS total_cost_usd,
         COUNT(*) FILTER (WHERE used_fallback)::text             AS fallback_calls,
         COUNT(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL)::text     AS distinct_runs,
         COUNT(DISTINCT report_id) FILTER (WHERE report_id IS NOT NULL)::text AS distinct_reports,
         COALESCE(SUM(duration_ms), 0)::text                     AS total_duration_ms
       FROM agent_executions
       WHERE created_at >= $1`,
      [sinceIso]
    );
    const r = rows[0];
    const distinctRuns = Number(r?.distinct_runs ?? 0);
    const totalCost = Number(r?.total_cost_usd ?? 0);
    const totalCalls = Number(r?.total_calls ?? 0);
    const fallback = Number(r?.fallback_calls ?? 0);

    res.json({
      available: true,
      days,
      totals: {
        totalCalls,
        totalInputTokens: Number(r?.total_input_tokens ?? 0),
        totalOutputTokens: Number(r?.total_output_tokens ?? 0),
        totalCostUsd: totalCost,
        totalDurationMs: Number(r?.total_duration_ms ?? 0),
        distinctRuns,
        distinctReports: Number(r?.distinct_reports ?? 0),
        fallbackCalls: fallback,
      },
      derived: {
        avgCostPerRunUsd: distinctRuns > 0 ? totalCost / distinctRuns : 0,
        avgCallsPerRun: distinctRuns > 0 ? totalCalls / distinctRuns : 0,
        fallbackRate: totalCalls > 0 ? fallback / totalCalls : 0,
      },
    });
  } catch (err) {
    if (isMigrationPending(err)) {
      res.json({ available: false, reason: 'migration_pending' });
      return;
    }
    next(err);
  }
});

// 2. Timeseries — daily cost rollup for the line/area chart.
router.get('/cost/timeseries', async (req, res, next) => {
  try {
    const { days, sinceIso } = parseCostWindow(req);
    const rows = await adminQuery<{
      day: string;
      total_cost_usd: string;
      total_tokens: string;
      call_count: string;
      distinct_runs: string;
    }>(
      `SELECT
         DATE(created_at)::text                                  AS day,
         COALESCE(SUM(calculated_cost_usd), 0)::text             AS total_cost_usd,
         COALESCE(SUM(total_tokens), 0)::text                    AS total_tokens,
         COUNT(*)::text                                          AS call_count,
         COUNT(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL)::text AS distinct_runs
       FROM agent_executions
       WHERE created_at >= $1
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [sinceIso]
    );
    res.json({
      available: true,
      days,
      points: rows.map((r) => ({
        day: r.day,
        totalCostUsd: Number(r.total_cost_usd),
        totalTokens: Number(r.total_tokens),
        callCount: Number(r.call_count),
        distinctRuns: Number(r.distinct_runs),
      })),
    });
  } catch (err) {
    if (isMigrationPending(err)) {
      res.json({ available: false, reason: 'migration_pending', points: [] });
      return;
    }
    next(err);
  }
});

// 3. Breakdown — pie/bar data; dimension = 'phase' | 'role' | 'model'.
router.get('/cost/breakdown', async (req, res, next) => {
  try {
    const { days, sinceIso } = parseCostWindow(req);
    const dimensionRaw = String(req.query.dimension || 'phase').toLowerCase();
    const dimensionCol =
      dimensionRaw === 'role' ? 'agent_role'
        : dimensionRaw === 'model' ? 'model'
        : 'phase';

    const rows = await adminQuery<{
      bucket: string;
      total_cost_usd: string;
      total_tokens: string;
      call_count: string;
    }>(
      `SELECT
         ${dimensionCol}                                         AS bucket,
         COALESCE(SUM(calculated_cost_usd), 0)::text             AS total_cost_usd,
         COALESCE(SUM(total_tokens), 0)::text                    AS total_tokens,
         COUNT(*)::text                                          AS call_count
       FROM agent_executions
       WHERE created_at >= $1
       GROUP BY ${dimensionCol}
       ORDER BY SUM(calculated_cost_usd) DESC NULLS LAST
       LIMIT 50`,
      [sinceIso]
    );
    res.json({
      available: true,
      days,
      dimension: dimensionCol,
      buckets: rows.map((r) => ({
        bucket: r.bucket,
        totalCostUsd: Number(r.total_cost_usd),
        totalTokens: Number(r.total_tokens),
        callCount: Number(r.call_count),
      })),
    });
  } catch (err) {
    if (isMigrationPending(err)) {
      res.json({ available: false, reason: 'migration_pending', buckets: [] });
      return;
    }
    next(err);
  }
});

// 4. Reports — paginated, filterable table of per-run cost rollups.
router.get('/cost/reports', async (req, res, next) => {
  try {
    const { days, sinceIso } = parseCostWindow(req);
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit as string, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);
    const userFilter = (req.query.userId as string | undefined)?.trim() || null;
    const phaseFilter = (req.query.phase as string | undefined)?.trim() || null;

    // Build WHERE clause incrementally — same idiom as /audit-log above.
    const where: string[] = ['ae.created_at >= $1'];
    const params: unknown[] = [sinceIso];
    let p = 2;
    if (userFilter) { where.push(`ae.user_id = $${p}`); params.push(userFilter); p++; }
    if (phaseFilter) {
      // When filtering by phase, only rows in that phase count toward
      // the per-run rollup. Document the semantics in the response.
      where.push(`ae.phase = $${p}`); params.push(phaseFilter); p++;
    }

    const sql = `
      SELECT
        ae.run_id,
        ae.report_id,
        ae.user_id,
        rr.title                                   AS run_title,
        rr.status                                  AS run_status,
        rr.research_objective,
        COUNT(*)::text                             AS call_count,
        SUM(ae.total_tokens)::text                 AS total_tokens,
        SUM(ae.duration_ms)::text                  AS total_duration_ms,
        SUM(ae.calculated_cost_usd)::text          AS total_cost_usd,
        COUNT(*) FILTER (WHERE ae.used_fallback)::text AS fallback_calls,
        MIN(ae.created_at)                         AS first_call_at,
        MAX(ae.created_at)                         AS last_call_at,
        -- "highest cost phase" per run, computed via a correlated subquery
        (
          SELECT ae2.phase
            FROM agent_executions ae2
           WHERE ae2.run_id = ae.run_id
           GROUP BY ae2.phase
           ORDER BY SUM(ae2.calculated_cost_usd) DESC NULLS LAST
           LIMIT 1
        )                                          AS top_phase
      FROM agent_executions ae
      LEFT JOIN research_runs rr ON rr.id = ae.run_id
      WHERE ${where.join(' AND ')}
        AND ae.run_id IS NOT NULL
      GROUP BY ae.run_id, ae.report_id, ae.user_id, rr.title, rr.status, rr.research_objective
      ORDER BY SUM(ae.calculated_cost_usd) DESC NULLS LAST
      LIMIT $${p} OFFSET $${p + 1}
    `;
    params.push(limit, offset);

    const rows = await adminQuery<Record<string, unknown>>(sql, params);

    res.json({
      available: true,
      days,
      limit,
      offset,
      filters: { userId: userFilter, phase: phaseFilter },
      rows: rows.map((r) => ({
        runId: r.run_id,
        reportId: r.report_id,
        userId: r.user_id,
        runTitle: r.run_title,
        runStatus: r.run_status,
        researchObjective: r.research_objective,
        callCount: Number(r.call_count),
        totalTokens: Number(r.total_tokens),
        totalDurationMs: Number(r.total_duration_ms),
        totalCostUsd: Number(r.total_cost_usd),
        fallbackCalls: Number(r.fallback_calls),
        firstCallAt: r.first_call_at,
        lastCallAt: r.last_call_at,
        topPhase: r.top_phase,
      })),
    });
  } catch (err) {
    if (isMigrationPending(err)) {
      res.json({ available: false, reason: 'migration_pending', rows: [] });
      return;
    }
    next(err);
  }
});
```

## Step 2 — Verify

```bash
cd backend
npx tsc --noEmit
npx vitest run adminDashboard requireAdmin
```

Test the deploy-skew path manually (drop the agent_executions table,
hit `/admin/cost/summary`, confirm HTTP 200 with `{available: false}`):

```bash
psql -c "BEGIN; DROP TABLE agent_executions; \
         SELECT pg_sleep(0.1); ROLLBACK;" &
curl -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3001/api/admin/cost/summary
```

(In production never actually drop the table; this is a dev-only
verification of the catch path. Use a vitest mock instead — see
`__tests__/costSidecarApi.test.ts`.)
