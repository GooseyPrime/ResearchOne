# Research One V2 Reliability + Visibility Plan
Date: 2026-04-26
Branch: `cursor/v2-research-stability-and-live-trace-c658`
HAR analyzed: `research-one-zeta.vercel.app.har` (commit `090bd4f`)

## 1. Bit-by-bit HAR analysis

200 entries, 5 hosts. There are exactly **two non-2xx entries**, and both are
expected behavior of the existing retry endpoint (see §2):

| status | count | notes |
|--------|------:|-------|
| 200    | 195   | normal |
| 202    | 1     | `POST /api/research` — accepted |
| 204    | 1     | CORS preflight |
| 101    | 1     | socket.io upgrade |
| 400    | 2     | `POST /api/research/<runId>/retry-from-failure` rejected because the row was still `running` |

The **400** body in both cases is literally:
`{"error":"Can only retry failed runs (current status=running)"}`

The run row that the HAR captures (`830ba101-…-585f91`, V2 engine) tells the
real story when its `GET /api/research/<id>` responses are decoded
(content-encoding `base64` in HAR; that's why earlier eyeballed views looked
empty):

| time          | run.status | progress.stage | failed_stage          | error_message |
|---------------|-----------:|----------------|-----------------------|---------------|
| 05:24:20.582  | running    | planning 5%    | null                  | (none)        |
| 05:24:24.775  | running    | discovery 15%  | null                  | (none)        |
| 05:24:50.020  | running    | retrieval 20%  | null                  | (none)        |
| 05:25:13.137  | running    | discovery 15%  | retriever_analysis    | HF inference failed (provider_unavailable, role=retriever, model=Qwen/Qwen2.5-32B-Instruct) |
| 05:26:25.226  | running    | discovery 15%  | null                  | (none)        |
| 05:26:56.630  | running    | retrieval 20%  | null                  | (none)        |
| 05:27:20.410  | running    | discovery 15%  | retriever_analysis    | same HF error |
| 05:27:52.334  | retry-from-failure → 400 (status was already running, so the retry endpoint refused the second click) |
| 05:28:33.929  | retry-from-failure → 200 (after a wait the row had become failed→queued again — retry happened) |
| 05:28:38–end  | running    | discovery 15%  | null                  | (none) — and then it stalls again |

So even though the actual upstream issue is **a single repeating problem**
(`Qwen/Qwen2.5-32B-Instruct` — V2 retriever default — getting `Failed to
perform inference: an HTTP error occurred when requesting the provider` from
HF Inference Providers), several UX bugs are layered on top of it:

1. **The progress polled by the UI never moves to a “Failed” terminal state.**
   The orchestrator catches the error and writes `status='failed'` for a
   moment, but BullMQ’s `attempts: 2` retries the same job, the worker resets
   `status='running'` + `progress_stage='discovery' / 15%`, and the cycle
   repeats. The user sees the run swing between “running 20% retrieval” and
   “running 15% discovery” forever.

2. **`retry-from-failure` collides with that.** When the user clicks Resume
   while the worker is mid-retry, the row is in `running` and the endpoint
   returns 400. That looks like “my retry was rejected” when really the
   system is silently retrying on its own.

3. **Fallbacks fire even when the user never opted in.** That part is *not*
   what happened in this HAR (`failure_meta.fallbackTried = false`,
   `providerFallbackAttempted = false`), but it is what I expected from your
   description, and the chain that decides this is brittle: the V2
   `resolveModelsForCall` path strips fallback only when
   `allowFallbackByRole[role] === true`, but `mergePresetWithRuntimeOverride`
   could still select a non-empty preset fallback in some paths. We have to
   make the V2 contract: **no fallback unless the user checked the per-role
   box, full stop.** And if the primary fails, the run stops and goes
   terminal — the BullMQ-level auto-retry on the same job has to be turned
   off for V2.

4. **The “Live research trace” is collapsed by default and only updates on
   socket events; the polled-row path produces a single coarse event, so the
   trace stays thin until the user clicks the chevron.**

5. **The `failed_stage` field flips back to `null` when the worker restarts
   the same job**, because we `UPDATE … failed_stage=NULL` only on success
   but `INSERT/UPDATE … status='running'` resets the *visible* progress to
   `planning/5%` then `discovery/15%`. So once a run has failed, the row
   visibly shows “running, discovery 15%” again and the user has no idea
   whether anything is actually happening.

6. **HF Inference is the *only* upstream that ever logged an attempt** in
   the user's HF dashboard, and OpenRouter only logged the OpenAI text
   embedding call. That confirms two things at the model layer:

   - The V2 retriever (and V2 utility models in general) are routed through
     the HF Inference Providers API — so they only work when HF has *some*
     provider live for that exact repo.
   - For `Qwen/Qwen2.5-32B-Instruct`, HF Inference currently lists exactly
     one provider (`featherless-ai`). That's why it shows up in your HF logs
     when it succeeds, and why it fails as `provider_unavailable` whenever
     featherless-ai has a hiccup. There is no built-in HF fall-through to
     another provider for this slug.
   - Embeddings still go via OpenRouter — that's correct; that path is
     working.

## 2. Model assessment vs. HF Inference Providers spec

> **Update 2026-04-27** — the first iteration of this plan moved V2 utility
> primaries onto `Qwen/Qwen2.5-72B-Instruct` and the V2 utility fallback
> onto `meta-llama/Llama-3.3-70B-Instruct`. Both of those are RLHF
> refusal-aligned models. That violates `ResearchOne PolicyOne` and the
> binding V2 selection criteria — using either as a V2 primary causes
> drift back toward consensus-debunking and silent omission of anomalous
> claims, which is exactly the contamination V2 exists to prevent.
>
> The corrected V2 matrix (this PR, current state) replaces every
> RLHF-aligned primary with an abliterated / uncensored / steerable
> open-weights model. The full criteria are now in
> [`docs/V2_MODEL_SELECTION_CRITERIA.md`](V2_MODEL_SELECTION_CRITERIA.md).

Cross-referencing the corrected V2 matrix against the live
`https://huggingface.co/inference/models` catalog:

| V2 slug                                                                       | Refusal head? | Role(s) (default) | Notes |
|-------------------------------------------------------------------------------|---------------|-------------------|-------|
| `NousResearch/Hermes-3-Llama-3.1-70B`                                         | None (steerable, low-refusal) | planner, drafter, synthesizer, coherence_refiner, plain_language_synthesizer, section_rewriter | Operator-prompt-as-authority alignment |
| `NousResearch/DeepHermes-3-Llama-3-8B-Preview`                                | None (steerable, low-refusal) | plain_language fallback | Smaller / faster |
| `huihui-ai/DeepSeek-R1-Distill-Llama-70B-abliterated`                         | Removed (abliterated) | reasoner, change_planner | R1 reasoning intact; Llama refusal direction orthogonalized |
| `huihui-ai/Llama-3.3-70B-Instruct-abliterated`                                | Removed (abliterated) | verifier, citation_integrity_checker, revision_intake, report_locator, final_revision_verifier; retriever fallback | Same Meta base capability as Llama-3.3-70B-Instruct, no refusal head |
| `huihui-ai/Qwen2.5-72B-Instruct-abliterated`                                  | Removed (abliterated) | retriever (every objective); patent-gap synthesizer / outline / coherence | Qwen structured-output strength preserved, alignment filter removed |
| `cognitivecomputations/dolphin-2.9.2-qwen2-72b`                               | Uncensored fine-tune | skeptic, internal_challenger (general / investigative / novel) | Adversarial primary |
| `cognitivecomputations/Dolphin3.0-Llama3.1-70B`                               | Uncensored fine-tune | adversarial / synthesis fallback | Newer Dolphin line |
| `DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-…`                                  | Abliterated MoE | skeptic, internal_challenger (patent / anomaly) | Anomaly red-team |

**Forbidden as V2 primary** (kept on the deployment allowlist for V1 / admin
user-opt-in fallback only): `meta-llama/Llama-3.3-70B-Instruct`,
`deepseek-ai/DeepSeek-R1-Distill-Llama-70B`, `Qwen/Qwen2.5-72B-Instruct`,
`Qwen/Qwen2.5-32B-Instruct`, `Qwen/Qwen2.5-14B-Instruct`,
`Qwen/QwQ-32B-Preview`.

The `Qwen/Qwen2.5-32B-Instruct` slug from the original HAR-captured
failure is still allowlisted (so admins can manually wire it in via per-run
overrides) but it is no longer the V2 retriever default. The new V2
retriever default `huihui-ai/Qwen2.5-72B-Instruct-abliterated` keeps
Qwen's structured-output behaviour for JSON-clean retriever output without
the alignment filter that drives debunking on anomalous claims, and is
hosted by multiple HF Inference Providers, removing the single-provider
flakiness symptom captured in the HAR.

### Allowlist + repo-prefix detector additions in this PR

- `huihui-ai/` is added to `isHfRepoModel(...)` so calls to abliterated
  variants route through the HF Inference Providers API.
- `BASE_ALLOWLIST` is split into a V1 / closed-weights section and a V2 /
  uncensored open-weights section. The startup validators
  (`validateReasoningModelPolicy` and
  `validateV2ModePresetsAgainstAllowlist`) still pass.

## 3. Behavioral / orchestration changes

These are the actual *fixes* to the loop you saw.

### 3.1 Stop the silent BullMQ retry on V2 runs

`researchQueue` has `defaultJobOptions.attempts: 2`. That's why the same
job comes back to life after orchestrator marks it `failed`. We will:

- enqueue every research job with `attempts: 1` explicitly. Application-level
  retry-from-failure (the button) is the *only* retry path. This eliminates
  the `failed → running → failed → running` flapping the HAR shows.
- add a hard `aborted` terminal state for runs whose retry-from-failure
  attempts have hit a configurable cap (default 3). After that, the row will
  be `aborted`, the UI will show `Aborted — no further retries` (not
  `running`), and the Resume button is hidden.

### 3.2 Make sure the run row reflects the *current* attempt, not stale state

When BullMQ does retry under the hood (which we are killing for V2), or
when application retry runs, we will:

- on worker entry: re-set `progress_stage`, `progress_percent`,
  `progress_message` to a `retrying` snapshot (`stage='retrying',
  percent=0, message='Retrying after previous failure'`) **before** the
  orchestrator's first `progress(...)` call. So the UI never shows
  `discovery 15%` from a previous attempt while the current attempt is
  actually still in `planning`.
- when retries are exhausted (status flipped to `aborted`), clear
  `progress_stage`, `progress_percent`, `progress_message` to NULL so no UI
  badge shows it as still alive.

### 3.3 V2 fallback contract: only fire when user explicitly opted in

`callRoleModel` already gates on `allowFallbackByRole[role] === true`, but
`resolveModelsForCall` uses `mergePresetWithRuntimeOverride` which still
returns a fallback when `allowFallbackForRole === true`. We:

- log every model selection: `usedFallback`, role, primary, whether the
  user opted in. This goes into the live trace (one event per call).
- change `callRoleModel` so that whenever `allowFallbackByRole[role] !==
  true`, the function never even *tries* a fallback model. Currently it
  drops fallback before the call, but the catch branch can still throw a
  shape that *implies* fallback was attempted. We will tighten the throw
  shape and the trace event so the user sees “no fallback, terminal”.

### 3.4 Live trace panel is now always-on and auto-populating

Frontend changes in `ResearchPageV2.tsx`:

- The "Live research trace" header no longer has a chevron / collapse — it
  is always rendered (still scrollable, capped at 150 events). The
  individual phase blocks remain collapsible only for past phases; the
  *current* phase auto-expands.
- A new `Aborted` final state badge.
- The active-run banner shows the *real* status (`Queued`, `Running`,
  `Retrying`, `Failed (retryable)`, `Failed (terminal)`, `Aborted`,
  `Cancelled`, `Completed`) computed from `run.status` + `failure_meta`,
  not from `progress_stage` alone — so a stalled discovery loop can no
  longer show "running" indefinitely.
- The failure card is rewritten to show **next-action guidance** instead of
  raw provider strings: a one-paragraph human explanation, the affected
  role + model, and either a "Resume from last failure" button (if
  retryable and budget remains) or an explicit "No more retries" disabled
  state with a guidance message.

### 3.5 More granular trace events from the orchestrator

We add explicit progress checkpoints at every phase:

- planner request started / response parsed (already there)
- discovery: queries planned, per-query started, per-query done, sources
  ingested
- retrieval: per-query started, per-query done
- retriever_analysis: started, completed, model id used
- reasoner started / completed
- skeptic started / completed (and red-team prefix applied or not)
- synthesis: outline started, per-section started/completed, total/total
- verifier started / completed
- plain_language started / completed
- saving started / completed
- epistemic_persistence started / completed

Each event includes the model that handled it and whether it was a
fallback (which, per 3.3, must remain `false` unless the user opted in).

### 3.6 Surface the model + endpoint per attempt in the trace

The earlier work already attaches `model`, `tokenUsage`, `substep` to
events; we are extending the trace renderer to show them inline (no
"Model call details" expand requirement). The chevron stays only as a
fallback for verbose `detail` strings.

## 4. Files affected (intent only — no edits yet)

- `backend/src/config/researchEnsemblePresets.ts` — V2 utility model
  defaults (§2)
- `backend/src/services/reasoning/researchOrchestrator.ts` — emit richer
  progress events; reset progress on retry; new `aborted` terminal state
- `backend/src/services/openrouter/openrouterService.ts` — strict V2
  fallback contract; log selection in trace
- `backend/src/queue/queues.ts` — `attempts: 1` for research queue
- `backend/src/queue/workers.ts` — emit `research:progress` with
  `retrying` substep at job-restart boundary; emit a structured
  `research:aborted` socket event
- `backend/src/api/routes/research.ts` — `retry-from-failure` returns a
  structured 200 with `attemptsRemaining`; expose `attemptsRemaining` and
  `aborted` on the run row payload; clamp at retry budget
- `backend/src/utils/researchRetryEligibility.ts` — count attempts /
  enforce budget
- `backend/src/db/migrations/012_research_run_aborted_state.sql` — new
  migration: add `'aborted'` to the run status enum/check; add
  `retry_budget` and `retry_attempts` columns
- `frontend/src/pages/ResearchPageV2.tsx` — always-on live trace; real
  status badge; richer failure card; aborted state
- `frontend/src/utils/api.ts` — `aborted` status type
- tests — extend
  `backend/src/__tests__/researchEnsemblePresets.test.ts` and add a new
  `researchRetryBudget.test.ts`

## 5. Strict policy compliance

- The reasoning-first epistemic preamble (`REASONING_FIRST_PREAMBLE`) is
  unchanged — every role still wraps its system prompt with
  `withPreamble(...)`.
- The V2 red-team system prefix (`RED_TEAM_V2_SYSTEM_PREFIX`) is
  unchanged and still applied to `skeptic` / `internal_challenger`
  whenever `engineVersion === 'v2'` and `callPurpose !==
  'contradiction_extraction'`.
- Every V2 default primary in the corrected matrix is uncensored,
  abliterated, or steerable open-weights. RLHF refusal-aligned slugs
  (`meta-llama/Llama-3.3-70B-Instruct`,
  `deepseek-ai/DeepSeek-R1-Distill-Llama-70B`,
  `Qwen/Qwen2.5-*-Instruct`, `Qwen/QwQ-32B-Preview`) are forbidden as V2
  primaries per the binding criteria in
  [`docs/V2_MODEL_SELECTION_CRITERIA.md`](V2_MODEL_SELECTION_CRITERIA.md);
  they remain allowlisted only for explicit per-role user opt-in via the
  V2 UI fallback checkbox.
- We are not introducing OpenRouter routing for V2 utility roles. V2
  routes through the HF Inference Providers API (HF_TOKEN required on
  the server). OpenRouter remains for V1 only.
- The reliability fixes (no silent BullMQ retry, `aborted` terminal
  state, retry budget, per-attempt progress reset, always-on live
  trace) all hold. They do not depend on which uncensored open-weights
  model is selected.
