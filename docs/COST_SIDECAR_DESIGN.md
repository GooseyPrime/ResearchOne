# Cost Telemetry Sidecar — Design ADR

**Status:** Approved for implementation (Work Order U).
**Date:** 2026-05-11.
**Authors:** Founder + AI engineering.

## Context

ResearchOne's 10-stage pipeline produces reports of highly variable cost.
A single Investigative Synthesis run on the V2 reasoner-class
(`qwen/qwen3-235b-a22b-thinking-2507`, ~$3/M tokens) with three Skeptic
rounds can spend 5–10× the tokens of a General Epistemic run on a smaller
default. Without per-report cost truth we cannot:

- Price Sovereign deals against real unit economics (the Master Brief
  $4,500/mo floor is set by best-guess).
- Tune V2 model defaults toward cheapest-that-passes-forbidden-defaults.
- Cap runaway reports before they blow a wallet hold.
- Defend pricing decisions to anchor pilots that ask "what's it cost you
  to make a report?"

The orchestrator already accumulates `ModelCallResult[]` and writes it
to `research_runs.model_log` (JSONB). That's enough raw data to
*compute* cost retroactively, but JSONB is the wrong shape for
analytics — every filter on user/date/role/model becomes a Postgres
JSON path lookup with no useful index. We need a relational
denormalization purpose-built for the admin dashboard.

## Decision

Implement an **internal sidecar pattern** — same logical structure as
the cost-accounting sidecar pattern from the original spec (separate
concern, idempotent emits, configurable pricing, admin-only analytics
surface) — but **in-process** rather than as a separate container. The
Node.js single-process model with `AsyncLocalStorage` gives us the
isolation benefits of a sidecar without the operational overhead of
managing a separate service, and the existing Postgres instance handles
the analytics workload trivially at our scale.

Three artifacts:

1. **`agent_executions` table** — relational per-call telemetry, one row
   per LLM call (primary + fallback = two rows). Indexed for the admin
   dashboard queries (by `run_id`, `(created_at, user_id)`, `agent_role`,
   `(phase, created_at)`).
2. **`model_pricing` table** — model id → input/output USD per 1M
   tokens, with `effective_from` for historical accuracy when a vendor
   raises prices mid-month.
3. **In-process sidecar service** (`backend/src/services/telemetry/`):
   - `runScope` — `AsyncLocalStorage<RunScopeContext>` that the
     orchestrator wraps the run body with. Every nested `callRoleModel`
     reads from this without any explicit parameter passing.
   - `pricingCatalog` — process-cached lookup `(model, when) → (input,
     output)` USD/1M, 60-second TTL.
   - `emitCallTelemetry` — fire-and-forget INSERT into
     `agent_executions`, with `ON CONFLICT DO NOTHING` on idempotency
     key. Errors swallowed and logged at DEBUG (so deploy-skew during
     migration rollout doesn't spam ERROR).

## Why not the literal sidecar-container pattern from the spec?

The original spec proposed a separate container with a callback hook
(`onLlmComplete`) and a stateful queue. That's the right shape for a
language-agnostic, multi-process, polyglot architecture (LangGraph in
Python, agents in Go, etc.). ResearchOne is one Node process with one
Postgres instance and ~thousands of reports/month at projected scale.
A separate container would add:

- A second deployment unit (PM2 process, Docker container) to keep
  alive — and the V2 outage postmortem (`docs/V2_OUTAGE_POSTMORTEM_2026-04-28-PM.md`)
  showed that adding deployment surface area carries real cost.
- A second Postgres connection pool or a queue (Redis stream / BullMQ)
  to hand telemetry off — more failure modes for zero analytical
  benefit at our query volume.
- A network hop and serialization layer for every telemetry event —
  10× the agent calls × n reports = real CPU even for a
  one-event-per-call payload.

**In-process `AsyncLocalStorage` is the same pattern semantically
(decoupled, async, non-blocking, idempotent) with one process instead
of two.** If we ever go polyglot or multi-process, we can lift this to
a true sidecar by replacing the writer with a queue producer; the
schema and the read-side admin API don't change.

## Why the schema looks the way it does

```
agent_executions(
  id, run_id, report_id, user_id, org_id,
  agent_role,    -- canonical role from REASONING_MODEL_ROLES
  phase,         -- human-grouped pipeline stage
  call_purpose,  -- 'pipeline_skeptic' | 'contradiction_extraction' | 'default'
  model,         -- exact model id used (primary OR fallback)
  used_fallback, -- whether this was a fallback call (so admin can
                 -- compute "how much did fallbacks cost us this month")
  input_tokens, output_tokens, total_tokens,
  duration_ms, started_at_ms, started_at,
  input_price_per_1m_usd,  -- price at emit time (frozen, not joined later)
  output_price_per_1m_usd, -- ditto; protects historical cost from later
                           -- pricing-table edits
  calculated_cost_usd,
  idempotency_key,         -- sha256(run_id || role || started_at_ms || model)
  metadata JSONB,          -- error_classification, retry_attempt, etc.
  created_at
)
```

Three design choices worth flagging:

**1. Prices stored per-row, not joined.** When a vendor raises prices,
historical reports should keep their original cost. Joining
`agent_executions` to `model_pricing` at read time would silently
restate history. We snapshot the price into the row at emit time. The
pricing table is a source of *current* truth for new rows only.

**2. `total_tokens` denormalized.** Postgres can compute `input_tokens
+ output_tokens` trivially but the admin dashboard sums `total_tokens`
in many queries; denormalizing trades 8 bytes/row for a measurably
simpler set of admin SQL queries. At 1M rows that's 8MB — irrelevant.

**3. `started_at_ms` (BIGINT) alongside `started_at` (TIMESTAMPTZ).**
The idempotency key uses millisecond precision; Postgres `TIMESTAMPTZ`
has microsecond precision but stringifying it for a hash is fragile
across timezones and serialization libraries. The BIGINT epoch ms is
canonical and deterministic.

## Rollout

1. Migration 030 ships. Deploy-skew tolerance means new code can hit
   prod before migration applies.
2. New code ships in a "shadow" mode: emit-only, no admin UI yet.
3. Verify `agent_executions` rows accumulate cleanly across one week
   of normal traffic. Cross-check `SUM(calculated_cost_usd) WHERE
   run_id = X` against the V2 reasoner provider's billing console for a
   spot-check sample.
4. Backfill historical runs via `scripts/backfill-cost-from-model-log.ts
   --since=2026-01-01`. Spot-check 10 random runs for sanity.
5. Admin UI ships behind the `RequireAdmin` guard, default `/admin/cost`
   visible alongside Run Telemetry and Audit Log.
6. Operators run the dashboard for one week to validate that cost
   numbers match intuition (V2 INVESTIGATIVE_SYNTHESIS runs should
   cluster around the known reasoner-class price band).
7. Pricing-table UI (future WO) — for now operators update
   `model_pricing` via SQL.

## Out of scope for this WO (deliberately)

- **Per-user cost limits / runaway-cap enforcement.** This WO is
  *observation only.* Enforcement (cap a run at $X.XX, refund wallet
  hold for the overage) is a future WO that will build on the
  observation infrastructure here.
- **A pricing-edit admin UI.** SQL-only edits are intentional for the
  first iteration — keeps the change surface small and forces operators
  to read the schema while we're still learning what shape the admin
  UX wants.
- **Per-token streaming cost.** OpenRouter only reports usage on
  completion (no token-by-token billing in the response stream).
  Real-time streaming cost would require a different provider contract.
- **Cost-aware model selection at runtime.** The reasoning model
  policy is currently capability-driven; making it cost-aware is a
  research project, not a WO.
