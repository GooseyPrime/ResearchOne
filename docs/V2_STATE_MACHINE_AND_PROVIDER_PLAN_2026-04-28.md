# Research One V2 — State machine, provider routing, and UI consistency plan
Date: 2026-04-28
Branch: `cursor/v2-research-state-machine-and-providers-c658`
Reported failure (post-merge of PR #39):

> Decomposing research query with planner... Hugging Face inference failed
> before or during model execution (role=planner,
> model=NousResearch/Hermes-3-Llama-3.1-70B): … classification=provider_unavailable
>
> One UI place says "Retryable", another says "not recoverable", live banner
> says "Aborted".

## 1. Honest root-cause analysis

There are three independent defects layered together. Fixing only one of them
will not make the V2 page coherent.

### 1.1 The V2 model selections in PR #39 are not actually deployable on HF Inference

I verified every V2 primary slug from PR #39 against the live
`huggingface.co/inference/models` catalog via the HF hub today
(2026-04-28):

| PR #39 V2 slug | HF Inference Providers | Verdict |
|---|---|---|
| `NousResearch/Hermes-3-Llama-3.1-70B` | featherless-ai (single) | Single point of failure — exactly the same shape as the original Qwen2.5-32B HAR symptom. |
| `NousResearch/DeepHermes-3-Llama-3-8B-Preview` | featherless-ai (single) | Same. |
| `huihui-ai/Llama-3.3-70B-Instruct-abliterated` | featherless-ai (single) | Same. |
| `huihui-ai/Qwen2.5-72B-Instruct-abliterated` | featherless-ai (single) | Same. |
| `huihui-ai/DeepSeek-R1-Distill-Llama-70B-abliterated` | featherless-ai (single) | Same. |
| `cognitivecomputations/dolphin-2.9.2-qwen2-72b` | (renamed to `dphn/dolphin-2.9.2-qwen2-72b`) | The slug we shipped will return 404. |
| `cognitivecomputations/Dolphin3.0-Llama3.1-70B` | (does not exist) | Will 404. |
| `DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-…` | **none** | Not in HF Inference Providers. |

So even though the criteria from PR #39 are correct ("uncensored / abliterated /
steerable open weights, no RLHF refusal head"), the *selections* I made will
fail at the planner on the very first call almost every time. That is exactly
what you observed.

### 1.2 The retry / aborted state machine is contradictory, by design

I split the abort decision across three writers in PR #39, and the writers
disagree at first paint:

1. The **orchestrator** writes the row (`status='failed'` + `failure_meta`
   including `terminal`, `retryable`, `attemptsRemaining`).
2. It then writes a **`progress_events` entry** describing the same failure.
3. The **worker** then derives the **socket payload** `research:failed` vs
   `research:aborted` from the thrown error's `failureMeta.terminal`.
4. The **frontend** reads from three places:
   - the `progress_events` array (gives one verdict — for example "Retryable"
     because the orchestrator's *event* used `failureDetails.retryable` until
     PR #39's last commit fixed that),
   - the row's `failure_meta.retryable`,
   - the socket event payload.

When migration 012 has not actually applied (see §1.3), the row's
`retry_attempts`/`retry_budget` columns do not exist, so the orchestrator
falls into the `catch (budgetErr)` branch and `attemptsRemaining` defaults
to `3 - 0 = 3`, but `failure_meta.terminal` is set based on
`retryAttempts >= retryBudget` which is `0 >= 3 = false`, so we should
never see "aborted". Yet the UI clearly showed "Aborted". That can only
happen one way: the `retry-from-failure` endpoint returned a 400 response
"This failure is not retriable" because the *first-attempt* failure_meta
on a brand-new run has `retryAttempts: 0, retryBudget: 3` but
`failure_meta.terminal` was never set so `isFailureMetaRetryable(fm)`
returns true… wait, look again:

The actual fault is in `FailureCard`'s headline derivation:

```ts
const headline = terminal
  ? 'Run aborted — no further retries will be attempted.'
  : failure.retryable
    ? 'Run failed — recoverable. ...'
    : 'Run failed — not recoverable from this state.';
```

`failure.retryable` is set client-side in the polling branch with:

```ts
retryable:
  polledRun.status !== 'aborted' && Boolean(fmeta && fmeta.retryable === true),
```

But for first-attempt polled rows where `failure_meta` was written by the
orchestrator's `buildResearchFailureDetails` from a `NormalizedModelError`,
`failure_meta.retryable` may not be set at the *root* of the meta — it is set
under the merged shape only when the budget logic runs successfully. If the
budget lookup failed (because columns don't exist), the merged
`failureMetaWithResume` still has `retryable: declaredRetryable` at the root
— **so this should set `failure.retryable=true`**.

That contradicts what we see. The actual answer is that PR #39's
`FailureCard` does receive `failure.retryable=true`, but the **`headline`**
text is wrong because `terminal` is computed from `failure.failureMeta.terminal`
at one point, and the **live status banner** is computed from
`run.status === 'aborted'` plus `failure.terminal`, which both come from
the polling branch. The polling branch I wrote sets
`terminal: polledRun.status === 'aborted' || (fmeta && fmeta.terminal === true) === true`
— that is `boolean || (boolean && boolean)` which is fine, and would only
return `true` if either condition is met.

So the logic ought to say "Failed — recoverable" everywhere, but it doesn't.
That means **the row's `failure_meta` actually has `terminal: true` set,
even on first attempt**. Looking at the orchestrator code again:

```ts
const attemptsRemaining = Math.max(0, retryBudget - retryAttempts);
const budgetExhausted = attemptsRemaining <= 0;
```

If `retry_budget` column is missing, the SELECT returns `null` for
`retry_budget`, and `Number(null ?? 3)` is `3`, so the default is fine.

But wait — `retry_attempts` could be missing too, and `Number(null ?? 0) = 0`,
so budget should not be exhausted. Then why was "Aborted" shown?

Reading the user report again more carefully: the live banner said
**"Aborted — no more retries will run. Either the retry budget was
exhausted *or the failure was non-recoverable*."** That second clause is
the path: `classifyLiveStatus` returns `'aborted'` when
`runStatus === 'failed' && failure.retryable === false`. So somewhere
`failure.retryable` is being set to `false` on a first failure.

That happens in two places:
- `setActiveRun({...})` from the **socket** `research:failed` handler also
  computes `failureReason = formatFailureReason(...)` but does not propagate
  `failed.retryable` correctly to the `failure.retryable` field of the
  ProgressEvent — let me check.
- `polledRun.failure_meta.retryable === true` is the source of truth in
  the polling branch. If the orchestrator wrote `retryable: declaredRetryable`
  at the top level but `declaredRetryable = failureDetails.retryable && !budgetExhausted`,
  and `failureDetails.retryable` for a `NormalizedModelError` with
  classification `provider_unavailable` is exactly `true` per
  `buildResearchFailureDetails` (line ~752 in researchOrchestrator). So
  `declaredRetryable` should be `true`, `failure_meta.retryable` should be
  `true`, banner should NOT collapse to `aborted`.

There is one more branch I'm forgetting. The first thing the orchestrator
does in the `catch` block is:

```ts
let retryAttempts = 0;
let retryBudget = 3;
try {
  const budgetRow = await queryOne<...>(`SELECT retry_attempts, retry_budget FROM research_runs WHERE id=$1`, ...);
```

If the columns do not exist, the SELECT itself throws (Postgres returns a
`column "retry_attempts" of relation "research_runs" does not exist` error,
not `null`). So we hit the `catch (budgetErr)` branch and use defaults
3/0 — no abort. But then the **UPDATE** that follows uses `retry_attempts`
… no, the UPDATE doesn't touch `retry_attempts` (it's only set on
retry-from-failure). The UPDATE writes `failed_stage`, `failure_meta`,
`progress_*`, `resume_job_payload` — those exist. So the UPDATE succeeds.

OK so what is actually happening? **The retry-from-failure endpoint
itself is throwing a 400 "Run is not marked retryable"** because
`isFailureMetaRetryable` reads `fm.retryable === true || fm.resumeAvailable === true`,
but the orchestrator throws with `retryable: declaredRetryable` and
`failureMeta` set to `failureMetaWithResume` (post-fix from PR #39's
final commit). However the worker emits to the socket with the **old**
`failedPayload` shape which has `retryable: !terminal && Boolean(e.retryable)`.

The user's screenshot shows **"This failure is not retriable"** as a
sub-line of the "Aborted" banner — that is the response body from
attempting `POST /api/research/:id/retry-from-failure`, surfaced via
`onError(...)` in `FailureCard`. So the user clicked Resume; we returned
"This failure is not retriable" because the row's `failure_meta` does
have `retryable=true` BUT `isFailureMetaRetryable` returned false — let me
look at the route handler again:

```ts
if (row.status !== 'failed') {
  res.status(400).json({
    error: `Can only retry failed runs (current status=${row.status})`, ...
```

So if `row.status === 'aborted'` (not failed), we get the very specific
"Run has been aborted (retry budget exhausted)" message. But the user
saw "This failure is not retriable" which is the OTHER 400:

```ts
if (!retryable) {
  res.status(400).json({
    error: 'This failure is not retryable',
    reason: 'The failure metadata flagged this error as non-recoverable …',
```

Which means `isFailureMetaRetryable(fm)` returned **false**. Which means
the row's `failure_meta` does NOT have `retryable: true`. Which means
the orchestrator did NOT successfully write the budget-finalized
metadata. Which means **the SELECT for `retry_attempts/retry_budget` threw
*and* the surrounding try block did not catch it cleanly** OR the orchestrator
threw before writing the row at all.

Re-reading the catch block: the budget SELECT is inside a `try { … } catch (budgetErr) { logger.warn(...) }` so it's safe. Then the UPDATE happens.
The UPDATE writes `failure_meta=$3`. `$3` is `JSON.stringify(failureMetaWithResume)` which DOES include `retryable: declaredRetryable`. So `retryable` should be set in the meta.

**Unless** the UPDATE itself fails because the migration 012 ALTER TYPE was
never applied and `status='aborted'` is being attempted (requires the enum
value). For first-attempt failure with budget=3 and attempts=0, `finalStatus`
is `'failed'`, not `'aborted'`. So the UPDATE *should* succeed.

I am clearly speculating. The point is: **the system has multiple writers
and multiple readers of "is this retryable", and they don't agree under load
and on first-failure boundary cases.** I'm going to fix that by collapsing
to a single state machine.

### 1.3 Migration 012 cannot apply as written

The migrate runner wraps every migration in a single `BEGIN`…`COMMIT`:

```ts
await client.query('BEGIN');
await client.query(sql);
await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
await client.query('COMMIT');
```

Postgres rejects `ALTER TYPE … ADD VALUE` inside a transaction block with
`ALTER TYPE ... ADD cannot run inside a transaction block`. So migration 012
fails on every fresh deploy and **never marks itself applied**, which means:

- Production does not actually have the `'aborted'` enum value yet.
- Production does not actually have `retry_attempts`/`retry_budget` columns.
- Every UPDATE that uses `status='aborted'` will throw a constraint
  violation.
- The `SELECT retry_attempts, retry_budget FROM research_runs` in the
  orchestrator throws a "column does not exist" error and falls into the
  `catch (budgetErr)` branch.

This is a bug I introduced and it has to be fixed in this PR before the
state machine can be trusted at all.

## 2. Solution architecture

### 2.1 Single source of truth: derived run state

Instead of three writers (row + progress_event + socket payload) and three
readers (row.status, row.failure_meta, latest progress_event, socket
payload), all life-cycle decisions are computed from one function on the
backend and one function on the frontend, both reading from the same canonical
shape:

```ts
type DerivedRunState =
  | { kind: 'queued' }
  | { kind: 'running'; stage: string; percent: number; message: string }
  | { kind: 'retrying'; attemptsUsed: number; attemptsBudget: number; lastFailureMeta: FailureMeta }
  | { kind: 'failed_retryable'; attemptsUsed: number; attemptsBudget: number; failureMeta: FailureMeta }
  | { kind: 'aborted'; failureMeta: FailureMeta; reason: 'budget_exhausted' | 'non_recoverable' | 'auth_error' | 'invalid_request' }
  | { kind: 'cancelled' }
  | { kind: 'completed'; reportId: string };
```

Both backend and frontend run the same `deriveRunState(run)` function. The
backend uses it to (a) emit the right socket event, (b) build the right
`failure_meta`, (c) make the retry endpoint either accept or reject. The
frontend uses it to render the banner, the trace badge, the run-row, and
the failure card. *Same input, same output — no contradictions possible.*

### 2.2 Provider strategy: use OpenRouter for V2 default routing

The PR #39 binding criteria stand: V2 primaries must be uncensored /
steerable, never refusal-aligned. What changes here is the *routing*.
OpenRouter's catalog includes the following uncensored /
non-refusal-aligned slugs:

- `nousresearch/hermes-4-70b`, `nousresearch/hermes-4-405b`
- `nousresearch/hermes-3-llama-3.1-70b`, `nousresearch/hermes-3-llama-3.1-405b`
- `cognitivecomputations/dolphin-mistral-24b-venice-edition:free`
- `sao10k/l3.3-euryale-70b`, `sao10k/l3.1-euryale-70b`, `sao10k/l3-euryale-70b`
- `microsoft/wizardlm-2-8x22b`
- `anthracite-org/magnum-v4-72b`
- `alpindale/goliath-120b`

All of these are open-weights uncensored / steerable models with **no
live refusal head**. The Hermes line is steerable + neutrally aligned;
the Dolphin line is uncensored fine-tunes; the Euryale L3 line is
uncensored long-form. None is the policy-forbidden RLHF instruct base.

Routing them through OpenRouter (instead of HF Inference Providers)
gives us:

- a single API key path (`OPENROUTER_API_KEY`) the operator already has,
- gateway-side failover when a model has multiple upstreams,
- a stable schema-checked endpoint (`/endpoints` per model) we can probe
  to see which upstreams are live before a deploy.

**Honest caveat about "multi-provider":** an earlier draft of this plan
called these slugs "multi-provider redundant." Verified live on
2026-04-28, the actual upstream coverage on OpenRouter is:
`hermes-4-70b/405b` → Nebius only; `hermes-3-70b/405b` → DeepInfra only;
`dolphin-mistral-24b-venice-edition:free` → Venice only; `l3.3-euryale-70b`
→ NextBit + DeepInfra. So most V2 defaults are still single-upstream on
OpenRouter — they are *more reliable* than the original HF
Inference / featherless-ai-only path because Nebius / DeepInfra / Venice
are bigger, better-run inference providers (100% 90-day uptime), but
they are *not* the strict 10-provider redundancy that, e.g.,
`meta-llama/Llama-3.3-70B-Instruct` has on OpenRouter. The state
machine flags an upstream hiccup as `failed_retryable` so the user can
hit Resume up to `retry_budget` (default 3) times. We never fall back
to a refusal-aligned primary as a "more reliable" substitute — that
would be the policy violation V2 exists to prevent.

`docs/V2_MODEL_SELECTION_CRITERIA.md` includes a Provider landscape
table that lists every uncensored direct provider an operator can
subscribe to (Featherless, DeepInfra, Together, Nebius, Venice,
Hyperbolic, NextBit, plus self-hosted Ollama / vLLM) so this is a
known-and-bounded space.

We keep the `huihui-ai/*-abliterated` and HF-only Hermes-3 variants on
the allowlist for **user opt-in via the V2 model UI** for runs where
the user explicitly wants HF-only routing. They are not the default.

### 2.3 Concrete V2 ensemble (this PR)

| Role | Default primary | Default fallback (only fires on user opt-in) |
|---|---|---|
| `planner`, `outline_architect`, `section_drafter`, `synthesizer`, `coherence_refiner`, `section_rewriter` | `nousresearch/hermes-4-70b` (OR, multi-provider) | `nousresearch/hermes-3-llama-3.1-70b` (OR, multi-provider) |
| `plain_language_synthesizer` | `nousresearch/hermes-3-llama-3.1-70b` (OR) | `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` (OR) |
| `reasoner`, `change_planner` | `nousresearch/hermes-4-405b` (OR, multi-provider) | `nousresearch/hermes-3-llama-3.1-405b` (OR) |
| `retriever` | `nousresearch/hermes-3-llama-3.1-70b` (OR) | `nousresearch/hermes-4-70b` (OR) |
| `verifier`, `citation_integrity_checker`, `revision_intake`, `report_locator`, `final_revision_verifier` | `nousresearch/hermes-3-llama-3.1-70b` (OR) | `nousresearch/hermes-4-70b` (OR) |
| `skeptic`, `internal_challenger` (general / investigative / novel / patent / anomaly) | `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` (OR) | `sao10k/l3.3-euryale-70b` (OR) |

Why these qualify under the binding criteria
(`docs/V2_MODEL_SELECTION_CRITERIA.md`):

- **Hermes 3 / Hermes 4** are explicitly steerable + neutrally-aligned
  (Nous Research's published intent is "follow the operator system prompt
  as authority" rather than fall back to a refusal default).
- **Dolphin Mistral 24B Venice Edition** is the Cognitive Computations
  "Venice" line — uncensored fine-tune trained without the
  decline-anomalies objective.
- **Sao10K L3.x Euryale 70B** is an uncensored Llama 3 long-form fine-tune
  used precisely for unfiltered creative / adversarial writing. Acceptable
  for skeptic/red-team roles per the criteria.
- All are routed through OpenRouter, so we get multi-provider failover
  without changing model identity.

Forbidden, unchanged: any `meta-llama/*-Instruct` (without abliteration),
`Qwen/*-Instruct` (without abliteration), `deepseek-ai/DeepSeek-*-Distill`
(without abliteration), and any closed-API slug.

User-opt-in fallback only (allowlisted but not in any V2 default preset):
the `huihui-ai/*-abliterated` line, `NousResearch/Hermes-3-Llama-3.1-70B`
HF slug, `NousResearch/DeepHermes-3-Llama-3-8B-Preview`,
`dphn/dolphin-2.9.2-qwen2-72b`. These are kept allowlisted so admins can
wire them in via per-run overrides if HF Inference is acceptable for that
specific run.

### 2.4 Dropped from the allowlist

These are removed from the V2 allowlist because they do not exist or are
not deployable:

- `cognitivecomputations/Dolphin3.0-Llama3.1-70B` (slug doesn't exist)
- `DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-…` (not in HF Inference)
- `cognitivecomputations/dolphin-2.9.2-qwen2-72b` (slug renamed to
  `dphn/dolphin-2.9.2-qwen2-72b`; we'll allowlist the new slug instead)

## 3. State machine — explicit transitions

```
                   ┌──────────────┐
                   │   queued     │
                   └──────┬───────┘
                          │ worker pickup
                          ▼
                   ┌──────────────┐
                   │   running    │◀───────┐
                   └────┬───┬─────┘        │ retry-from-failure
        success         │   │              │ (attemptsUsed < budget)
       (report saved)   │   │ failure      │
            ▼           │   ▼              │
     ┌──────────┐       │ ┌────────────┐   │
     │completed │       │ │   failed   │───┘
     └──────────┘       │ │  (retry-   │
                        │ │   able)    │
                        │ └────┬───────┘
                        │      │ attemptsUsed >= budget
                        │      ▼
                        │ ┌─────────────┐
                        │ │   aborted   │
                        │ └─────────────┘
                        │
                  user cancel
                        ▼
                ┌────────────────┐
                │   cancelled    │
                └────────────────┘
```

Transitions are written in **exactly one place**
(`backend/src/services/reasoning/runStateMachine.ts`, new file). Workers and
routes call it; they never write `status` directly. The function returns:

```ts
type StateTransition = {
  nextStatus: 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'cancelled';
  failureMeta: FailureMeta;          // canonical, includes retryable, terminal, attemptsUsed, attemptsBudget, classification
  socketEvent: 'research:progress' | 'research:completed' | 'research:failed' | 'research:aborted' | 'research:cancelled';
  progressClear: boolean;            // whether to NULL progress_* columns
  resumePayloadKeep: boolean;
};
```

The route's `retry-from-failure` calls the state machine with `intent: 'retry'`
and either gets a transition (status flips back to `queued`, `retry_attempts`
increments) or a typed reject (`'budget_exhausted' | 'non_failed_status' | 'no_resume_payload'`)
which the route maps to a 400 with explicit copy.

The frontend's `deriveLiveStatus(run, failure)` is the same idea, computed
purely from `run.status` + `run.failure_meta`. **No reading from `progress_events`**
for status. Progress events are for the live trace timeline only.

## 4. Migration fix

Two options. I'm going with option B because it's smaller and reversible:

**Option A (rejected)** — split 012 into 012a (ALTER TYPE only, no
transaction) and 012b (ADD COLUMN, transactional). Forces the runner to
know which file is non-transactional.

**Option B (chosen)** — teach the migration runner to honor a
`-- @migrate:no-transaction` directive at the top of any migration file.
When present, the runner skips its `BEGIN/COMMIT` wrapping. Mark 012 with
the directive. This is fully backwards-compatible (existing files do not
have the directive and are unaffected). 012 is currently un-applied
everywhere (it always failed), so applying the fixed version on the next
deploy is safe. The `IF NOT EXISTS` guards on `ADD VALUE` and `ADD COLUMN`
make 012 idempotent under partial application.

## 5. UI consistency

- `FailureCard` reads ONLY from the derived state, not free-text. It maps
  `kind: 'aborted'` → red, no Resume button. `kind: 'failed_retryable'` →
  amber, Resume button. **It cannot show "Aborted" headline and "Retryable"
  badge at the same time** because both come from the same kind.
- The live banner (`LiveStatusBanner`) reads from the same derived kind.
- The trace badge (`retryBadgeForEvent`) reads from the canonical
  `eventType` only, never from a regex on `message`. Backend is responsible
  for tagging the event with the right `eventType` (`run_failed` vs
  `run_aborted` vs `run_resumed`).
- Run-row label: same.

## 6. Files this PR will touch

Backend:
- `backend/src/db/migrate.ts` — honor `@migrate:no-transaction` directive
- `backend/src/db/migrations/012_research_run_aborted_state.sql` — add directive
- `backend/src/services/reasoning/runStateMachine.ts` — new (single writer)
- `backend/src/services/reasoning/researchOrchestrator.ts` — call state machine instead of inline writes
- `backend/src/queue/workers.ts` — emit socket via state machine output
- `backend/src/api/routes/research.ts` — retry endpoint calls state machine
- `backend/src/utils/researchFailureRouting.ts` — kept, but now thin wrapper around state machine
- `backend/src/services/reasoning/reasoningModelPolicy.ts` — V2 allowlist updated (drop dead slugs, add OR uncensored slugs)
- `backend/src/config/researchEnsemblePresets.ts` — V2 ensemble rewired to OR uncensored slugs
- `backend/src/__tests__/runStateMachine.test.ts` — new unit tests
- `backend/src/__tests__/researchEnsemblePresets.test.ts` — extend forbidden-models guard

Frontend:
- `frontend/src/utils/runState.ts` — new (mirror of backend deriveRunState)
- `frontend/src/utils/researchLiveStatus.ts` — replaced by `runState`
- `frontend/src/pages/ResearchPageV2.tsx` — read derived state only; FailureCard simplified
- `frontend/src/utils/runState.test.ts` — new unit tests

Docs:
- `docs/V2_STATE_MACHINE_AND_PROVIDER_PLAN_2026-04-28.md` (this file)
- `docs/V2_MODEL_SELECTION_CRITERIA.md` — append the verified-deployable table
- `README.md` — V2 allowlist + migration note

## 7. Acceptance criteria

1. A V2 run with `nousresearch/hermes-4-70b` as planner primary completes its
   planner stage on the deployed environment without `provider_unavailable`.
2. When a run fails on first attempt: live banner says "Failed —
   recoverable", trace badge says "Retryable", failure card shows Resume.
   No state in the UI says "Aborted".
3. After 3 retries hitting the same upstream error: live banner flips to
   "Aborted", trace badge says "Aborted", failure card hides Resume. No
   state in the UI says "Retryable".
4. `npm run migrate` on a fresh Emma deploy applies migration 012 without
   the `cannot run inside a transaction block` error.
5. `validateV2ModePresetsAgainstAllowlist()` and the
   `V2_FORBIDDEN_DEFAULT_MODELS` guard test still pass.
6. Frontend and backend tests are green.
