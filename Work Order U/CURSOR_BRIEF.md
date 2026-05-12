# Cursor Brief — WO-U Cost Telemetry Sidecar

**Read this first.** This brief tells Cursor what to read, in what
order, and what to apply, in what order. Every artifact in this
package has a purpose and a place; doing them out of order will
produce a working build that fails one or more invariants.

---

## Goal in one sentence

Add per-LLM-call cost telemetry to the ResearchOne 10-stage pipeline,
surfaced in a new admin dashboard at `/app/admin/cost`, without
changing any LLM call site outside `openrouterService.ts:callRoleModel`,
without breaking any existing test, and without 500-ing during the
migration rollout window.

---

## Reading order (do this BEFORE writing any code)

1. **`.cursor/rules/00-pre-commit-review.mdc`** — the master checklist
   you walk before every commit. Already exists in the repo.
2. **`.cursor/rules/25-cost-sidecar-and-unit-economics.mdc`** — the
   ten invariants that govern this WO. **NEW** — in this package.
3. **`docs/COST_SIDECAR_DESIGN.md`** — the architecture decision record
   that explains why we chose in-process AsyncLocalStorage over a
   literal sidecar container, why prices are snapshotted per-row, why
   `total_tokens` is a stored generated column. **NEW** — in this
   package.
4. **`docs/ResearchOne - Work Order U.md`** — the formal Work Order
   itself (matches the WO-T / WO-S format). **NEW** — in this package.
5. Existing code to read end-to-end before patching:
   - `backend/src/services/openrouter/openrouterService.ts` (lines 28–67 type, 578–740 `callRoleModel`)
   - `backend/src/services/reasoning/researchOrchestrator.ts` (line 183 entry, line 226 `modelLog` pattern, line 708 `model_log` JSONB write)
   - `backend/src/services/reasoning/reportRevisionService.ts` (line 192 `createReportRevision`)
   - `backend/src/services/discovery/discoveryOrchestrator.ts` (line 122 `runDiscoveryOrchestrator`)
   - `backend/src/db/pool.ts` (the `rlsStore` AsyncLocalStorage pattern we mirror)
   - `backend/src/api/routes/admin.ts` (lines 474–504 — the `/telemetry/runs` and `/audit-log` precedents)

---

## Write order (apply these in EXACTLY this order)

### Phase A — Schema and Cursor rule (no behavioral change)

These can ship in a deploy ahead of any code change.

1. **`.cursor/rules/25-cost-sidecar-and-unit-economics.mdc`** — copy
   from this package to `.cursor/rules/`. Read it. Then refer back to
   it as you do every subsequent step.
2. **`docs/COST_SIDECAR_DESIGN.md`** — copy to `docs/`.
3. **`docs/ResearchOne - Work Order U.md`** — copy to `docs/`.
4. **`backend/src/db/migrations/030_cost_telemetry.sql`** — copy to
   `backend/src/db/migrations/`. Run `npm run migrate` in `backend/`
   to apply. Confirm `psql -c "\d agent_executions"` shows the table.

### Phase B — Sidecar services (still no behavioral change)

These add code, but nothing calls into it yet.

5. **`backend/src/services/telemetry/pricingCatalog.ts`** — copy as-is.
6. **`backend/src/services/telemetry/costSidecar.ts`** — copy as-is.
7. **`backend/src/services/telemetry/index.ts`** — copy as-is.
8. **`backend/src/__tests__/costSidecar.test.ts`** — copy and run
   `npx vitest run costSidecar`. All assertions should pass with the
   sidecar code in place. **They should all FAIL if the sidecar code
   is reverted — verify this manually for at least three assertions
   per Cursor rule 16.**

### Phase C — Wiring (behavioral change starts here)

The order matters: ship the emit hook BEFORE the orchestrator wrap.
If you ship the orchestrator wrap first, all calls will emit with
no telemetry (no-op until the openrouter hook lands) — wasted
deploy cycle. If you ship the openrouter hook first, all calls will
emit with `run_id IS NULL` — they'll all bucket as "no-attribution"
in analytics but won't crash anything.

9.  **PATCH-01** — `backend/src/services/openrouter/openrouterService.ts`.
    Apply per `patches/PATCH-01-openrouterService-emit-hook.md`.
10. **PATCH-02** — `backend/src/services/reasoning/researchOrchestrator.ts`.
    Apply per `patches/PATCH-02-researchOrchestrator-runScope.md`.
11. **PATCH-03** — `backend/src/services/discovery/discoveryOrchestrator.ts`.
    Apply per `patches/PATCH-03-discoveryOrchestrator-phaseOverride.md`.
12. **PATCH-04** — `backend/src/services/reasoning/reportRevisionService.ts`.
    Apply per `patches/PATCH-04-reportRevisionService-runScope.md`.
13. **PATCH-05** — verification only. Run the greps documented in
    `patches/PATCH-05-inherited-scope-verification.md`. Confirm no
    additional scope wraps are needed.
14. **PATCH-06** — verification only. Run the greps and the post-deploy
    smoke test documented in
    `patches/PATCH-06-worker-scope-propagation.md`. Hold off on the
    smoke test until after the admin endpoints are also live so you
    can verify the round trip.

At this point: `npx tsc --noEmit && npx vitest run` must pass in the
`backend/` directory. The orchestrator and revision pipelines run as
before but now emit `agent_executions` rows on every LLM call.

### Phase D — Admin API surface

15. **PATCH-07** — `backend/src/api/routes/admin.ts`. Apply per
    `patches/PATCH-07-admin-cost-endpoints.md`.
16. **`backend/src/__tests__/costSidecarApi.test.ts`** — copy and run
    `npx vitest run costSidecarApi`.

### Phase E — Frontend

17. **`frontend/src/pages/admin/CostAnalytics.tsx`** — copy as-is.
18. **PATCH-08** — `frontend/src/App.tsx` and
    `frontend/src/pages/admin/AdminDashboard.tsx`. Apply per
    `patches/PATCH-08-frontend-routing-nav.md`.

At this point: `npx tsc --noEmit && npm run build` must pass in the
`frontend/` directory. Visit `/app/admin/cost` and confirm the page
renders.

### Phase F — Backfill (one-shot, can be done any time after Phase B)

19. **`backend/scripts/backfill-cost-from-model-log.ts`** — copy to
    `backend/scripts/`. First run with `--dry-run`:

    ```bash
    tsx backend/scripts/backfill-cost-from-model-log.ts --since=2026-01-01 --dry-run --limit=10
    ```

    Spot-check the output. Then run for real:

    ```bash
    tsx backend/scripts/backfill-cost-from-model-log.ts --since=2026-01-01
    ```

    Re-run to confirm idempotency — second run should report
    `rows inserted: 0, rows skipped (idempotent): N` where N matches
    the first run's `inserted` count.

---

## Pre-commit grep checks (Rule 25 invariants)

Before every commit in this WO, run these and confirm the expected
counts:

```bash
# I-1 — single emit point
grep -rn "emitCallTelemetry" backend/src --include='*.ts' \
  | grep -v __tests__ | grep -v telemetry/
# Expected: exactly 2 hits, both in openrouter/openrouterService.ts

# I-2 — three scope wrappers, no more no less
grep -rn "runScope.run" backend/src --include='*.ts' \
  | grep -v __tests__ | grep -v telemetry/
# Expected: exactly 3 hits — researchOrchestrator.ts, discoveryOrchestrator.ts,
# reportRevisionService.ts

# Inner functions not exported anywhere they shouldn't be
grep -rn "runResearchJobInner\|createReportRevisionInner\|runDiscoveryOrchestratorInner" \
  backend/src --include='*.ts'
# Expected: each name appears only in the file that defines it.
# Outside imports = bypassed scope = bug.

# I-9 — role-phase mapping covers every canonical role
grep -A 100 "function rolePhaseFor" backend/src/services/telemetry/costSidecar.ts \
  | grep "case '"
# Cross-check against REASONING_MODEL_ROLES in
# backend/src/services/reasoning/reasoningModelPolicy.ts.
# Every role in REASONING_MODEL_ROLES must have a case OR fall into
# a documented bucket (synthesizer/outline_architect/section_drafter/
# coherence_refiner all → Synthesis is correct).
```

---

## Smoke test after full rollout

```bash
# 1. Apply migration.
cd backend && npm run migrate

# 2. Start a research run via the API.
curl -X POST 'http://localhost:3001/api/research' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"smoke test cost sidecar","researchObjective":"GENERAL_EPISTEMIC_RESEARCH"}'

# 3. Wait ~2 minutes for completion.

# 4. Inspect the rows.
psql $DATABASE_URL <<EOF
  SELECT run_id, agent_role, phase, model,
         total_tokens, duration_ms,
         calculated_cost_usd, used_fallback
    FROM agent_executions
   WHERE run_id = (SELECT id FROM research_runs ORDER BY created_at DESC LIMIT 1)
   ORDER BY started_at_ms;
EOF
# Expected: 6–10 rows, non-zero tokens, non-zero duration_ms, phase
# values from the canonical enum, calculated_cost_usd > 0 (unless a
# model fell off the pricing catalog — check WARN logs for unknown
# models if you see $0).

# 5. Cross-check the dashboard.
# Visit http://localhost:5173/app/admin/cost
# - KPI cards show non-zero values
# - Line chart has at least one data point
# - Pie chart shows phase breakdown with multiple colored slices
# - Table shows the smoke-test run with the same total cost as step 4
```

---

## What this WO explicitly does NOT do

- **Does not enforce cost limits or runaway caps.** This WO is
  observation only. Enforcement (cap a run at $X, refund wallet hold
  for the overage) is a future WO that will read from
  `agent_executions` in real time. The observation infrastructure
  here is the prerequisite, not the deliverable.
- **Does not provide an admin UI for editing prices.** SQL-only edits
  are intentional for the first iteration. Once we know what shape
  the operator UX wants (after a few real price updates), a future
  WO can add a `<PricingTable />` page.
- **Does not track per-token streaming cost.** OpenRouter only
  reports usage on completion. Real-time streaming cost requires a
  different provider contract and a different schema.
- **Does not make model selection cost-aware.** The reasoning model
  policy is capability-driven; making it cost-aware is research, not
  a Work Order.

These are deliberate scope cuts per `docs/COST_SIDECAR_DESIGN.md`.
Don't be tempted to scope-creep — every adjacent feature is a
separate WO that can build on this foundation cleanly.

---

## Companion Work Orders in this package

This package was delivered alongside the cost sidecar (WO-U). The
three companion WOs are independent — each can land on its own
schedule — but two of them have composition points with WO-U worth
flagging:

| WO | Focus | Composition with WO-U |
|---|---|---|
| **WO-V** | Lab Notebook visual architecture + persona-adaptive landing | None — pure frontend; doesn't touch backend. |
| **WO-W** | Animated 10-stage pipeline hero | None — composes on top of WO-V's design tokens. |
| **WO-X** | Pandoc + xelatex academic formatting engine | **Adds `citation_formatter` to `REASONING_MODEL_ROLES`** which under Rule 25 I-9 requires adding its phase mapping in `costSidecar.ts:rolePhaseFor` in the SAME commit. The new role's cost will then automatically flow into the dashboard via the existing emit hook. |

WO-X's intersection with WO-U is the only cross-WO contract in this
package; everything else composes cleanly via the existing emit
infrastructure.
