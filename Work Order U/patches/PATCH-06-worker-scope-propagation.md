# PATCH 06 — BullMQ workers: scope propagation across the job boundary

**Files:**

- `backend/src/queue/workers/` (the research worker — exact filename
  varies; grep `runResearchJob` inside `backend/src/queue/` to find it)
- `backend/src/queue/workers/livingReportRevisionWorker.ts` (when WO-T
  is merged — if not yet, skip this half of the patch)

**Why:** BullMQ jobs are dispatched on Redis. The job handler runs in a
fresh async stack with NO inherited AsyncLocalStorage context — even
if the producer was inside a scope, the consumer is not. So a job
handler that calls `runResearchJob(...)` must do so AFTER its own
scope setup, which PATCH 02 and PATCH 04's wrappers handle correctly.

**This patch is a verification step, not a code change** — the
orchestrator and revision-service entry wrappers (PATCHes 02 and 04)
are designed to be safe to call from inside or outside an existing
scope. The worker doesn't need to set up scope itself; it just calls
`runResearchJob(...)` or `createReportRevision(...)` and those entry
points establish scope internally.

---

## Verification

### Step 1 — Locate the research worker

```bash
grep -rn "runResearchJob" backend/src/queue/ --include='*.ts'
```

Expected: one match in a file like `workers/researchWorker.ts` or
`workers.ts`. The match should look like:

```ts
await runResearchJob(jobData, onProgress);
```

This is correct — the worker passes job data directly. PATCH 02's
wrapper establishes scope FROM the job data
(`data.creditChargeContext.userId`, `data.runId`).

### Step 2 — Confirm no worker is calling `runResearchJobInner` directly

```bash
grep -rn "runResearchJobInner\|createReportRevisionInner\|runDiscoveryOrchestratorInner" backend/src --include='*.ts'
```

Expected output: zero hits outside the file that defines each inner.
The inner functions are intentionally not exported. If anything outside
its own file imports an inner function, scope would be bypassed —
escalate immediately. (Per Cursor rule 17 ripple.)

### Step 3 — When WO-T's living-report worker exists

If `backend/src/queue/workers/livingReportRevisionWorker.ts` is present
(WO-T merged), confirm it calls `createReportRevision(...)` — not any
private inner — and that it passes `args.initiatedBy` and `args.reportId`
correctly. The revision scope wrapper in PATCH 04 then handles the
rest.

### Step 4 — Smoke test the worker emit path

After the migration applies and PATCHes 01–04 are in:

```bash
# Run one research job end-to-end against a dev DB:
curl -X POST 'http://localhost:3001/api/research' \
  -H 'Authorization: Bearer $DEV_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{ "query": "test cost sidecar emission", ... }'

# Wait for completion (or check the worker logs).
# Then verify the emit:
psql -c "
  SELECT run_id, agent_role, phase, model, total_tokens, calculated_cost_usd
    FROM agent_executions
   WHERE run_id = (SELECT id FROM research_runs ORDER BY created_at DESC LIMIT 1)
   ORDER BY started_at_ms;
"
```

Expected: 6–10 rows (one per agent call), with non-NULL `run_id`,
non-zero `total_tokens`, `phase` values matching the natural pipeline
phases (Planning, Discovery, Retrieval, Reasoning, Skeptic, Synthesis,
Verification, Plain Language).

If `agent_executions` is empty after a completed run, scope was
never established — check PATCH 02 Step 2 didn't get reverted by a
merge conflict.

## Reminder per Rule 25 invariant I-3

The emit path is fire-and-forget. If the smoke test produces a
completed `research_runs` row but ZERO `agent_executions` rows, this
is **not a failed research run** — it's a failed telemetry write. The
report still generated correctly. Treat it as a P2 (observability bug)
not a P0 (pipeline broken).
