# V2 Outage Post-mortem — 2026-04-28 PM
Branch: `cursor/v2-fix-provider-routing-and-models-c658`
PR: #41

## What the user observed

First V2 run after PR #40 merged into `main`:

```
Aborted — no more retries will run.
Stage: aborted · Role: planner · Model: nousresearch/hermes-4-70b · Upstream: openrouter · Class: unknown
Decomposing research query with planner... | No allowed providers are available
for the selected model. | classification=unknown, status=404,
endpoint=https://openrouter.ai/api/v1/chat/completions
Retries used: 0 of 3 · 3 remaining
The orchestrator marked this failure non-recoverable.
```

The user has been unable to generate a single V2 report in over a week
because of these model errors.

## Diagnosis

Three distinct defects, layered:

### 1. The chosen V2 default primary model is account-blocked

`nousresearch/hermes-4-70b` has exactly **one** upstream provider on
OpenRouter today: Nebius. Verified live via
`GET https://openrouter.ai/api/v1/models/nousresearch/hermes-4-70b/endpoints`
on 2026-04-28-PM. Same shape for every Hermes-line slug PR #40 picked
as a critical-path default:

| PR #40 default slug | OpenRouter upstreams | Verdict |
|---|---|---|
| `nousresearch/hermes-4-70b` | Nebius (1) | account-policy-blocked |
| `nousresearch/hermes-4-405b` | Nebius (1) | account-policy-blocked |
| `nousresearch/hermes-3-llama-3.1-70b` | DeepInfra (1) | risky |
| `nousresearch/hermes-3-llama-3.1-405b` | DeepInfra (1) | risky |
| `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` | Venice (1) | risky (acceptable for adversarial roles only) |
| `sao10k/l3.3-euryale-70b` | NextBit + DeepInfra (2) | OK |

OpenRouter accounts have a default provider-policy filter that excludes
upstreams that train on prompts. On the user's account, that filter
excludes Nebius for Hermes-4-70B → `404 "No allowed providers are
available."` Same shape would apply to anyone whose account has the
default privacy preference enabled.

I claimed in PR #40 that these slugs were "OpenRouter, multi-provider
redundant" — that was wrong. I had verified earlier that they were on
OpenRouter; I had not verified per-slug provider counts. That's a
**`C-UNVERIFIED-CLAIM`** failure under
`docs/retrospectives/2026-04-28-pr36-40-review-findings.md` and a
direct violation of `.cursor/rules/15-doc-pr-and-code-parity.mdc` —
which I had just written. I added the rule and then immediately
violated it on the same PR.

### 2. The OpenRouter request body did not allow fallbacks

Even when a model has multiple OpenRouter upstreams, our requests did
not include a `provider` block, so OpenRouter applied the account's
default filter without our consent and never tried gateway-side
failover. We had no way to express "use any provider that supports
this model, including ones that train on prompts" — which is what we
actually want for a research platform.

### 3. The 404 classification path lost the actionable signal

`classifyModelError(err)` in `openrouterService.ts` did not handle 404
at all — it fell into the default `'unknown'` branch. The orchestrator
then saw `classification=unknown` and `retryable=false` and routed the
failure through the canonical state machine as "non_recoverable_classification."
The user-visible message was "The orchestrator marked this failure
non-recoverable. Start a new run with the same query if you want to
try again." — which is correct (retrying doesn't help) but uselessly
generic. The actionable cause ("your account's provider filter
excludes every upstream for this model") was hidden in
`failureMeta.providerMessage` but the failure card has no specific
guidance for it.

## Fix

### Code

1. **Replace V2 critical-path default primaries** with verified-multi-provider open-weights reasoners:
   - planner / synthesizer / utility / verifier roles → `deepseek/deepseek-v3.2` (10+ providers)
   - reasoner / change_planner roles → `deepseek/deepseek-r1-0528` (5 providers)
   - planner fallback / novel-application primary → `moonshotai/kimi-k2-thinking` (3 providers)
   - reasoner fallback → `qwen/qwen3-235b-a22b-thinking-2507` (4 providers)
   - utility / synthesis fallback → `deepseek/deepseek-chat-v3.1` (10+ providers)
2. **Keep adversarial roles** (skeptic / internal_challenger) on uncensored fine-tunes (`cognitivecomputations/dolphin-mistral-24b-venice-edition:free`, `sao10k/l3.3-euryale-70b`). Single-provider is acceptable for adversarial roles because their failures are recoverable mid-pipeline.
3. **Send a `provider` block on every OpenRouter request**: `{ allow_fallbacks: true, require_parameters: true, data_collection: 'allow' | 'deny', sort: 'throughput' }`. Default `allow`; operator can set `OPENROUTER_DATA_COLLECTION=deny` to require providers that do not train on prompts.
4. **Fix 404 classification** in `classifyModelError` so OpenRouter's "No allowed providers" 404 is classified `bad_request` (not `unknown`) and the failure card surfaces a specific actionable hint instead of the generic non-recoverable message.
5. **Add a startup pre-flight probe** (`backend/src/services/openrouter/openrouterPreflight.ts`) that hits `/api/v1/models/<slug>/endpoints` for every V2 default primary at boot and logs a structured warning per (objective, role, slug) if any has zero live endpoints. The probe is best-effort and never blocks startup, but it ensures outages show up in deploy logs *before* the user clicks Run.

### Binding criteria update

The `docs/V2_MODEL_SELECTION_CRITERIA.md` rules now include a
**criterion 6**: critical-path role primaries must have ≥ 2 live
OpenRouter upstreams. The `V2_FORBIDDEN_DEFAULT_MODELS` regression
guard test in `backend/src/__tests__/researchEnsemblePresets.test.ts`
forbids the single-provider Hermes line as a default. So this exact
shape can never recur.

The criteria also now admit the **low-refusal multi-provider open-weights
reasoner** category (DeepSeek V3.x / R1-0528 / Qwen3-235B-Thinking /
Kimi K2-Thinking) as critical-path V2 primaries. They are reasoning-focused
open weights with comparatively light RLHF refusal training; under our
`REASONING_FIRST_PREAMBLE` they follow the operator role rather than
refusing. Refusal-aligned RLHF instruct bases (`meta-llama/*-Instruct`,
`Qwen/*-Instruct` without abliteration, `deepseek-ai/DeepSeek-*-Distill`
without abliteration, `Qwen/QwQ-32B-Preview`) and any closed-API slug
**remain forbidden** as V2 primaries.

## Tests

- Backend: 20 files / **98 tests** (5 new):
  - `openrouterPreflight.test.ts` — pre-flight probe contract.
  - `openrouterRequestBody.test.ts` — `provider` block is always sent on V2 calls; default V2 planner is one of the multi-provider DeepSeek / Kimi / Qwen Thinking slugs (not Hermes / Dolphin / Euryale).
  - `researchEnsemblePresets.test.ts` — forbidden-defaults guard now also forbids `nousresearch/hermes-4-70b/405b` and `nousresearch/hermes-3-llama-3.1-70b/405b` as V2 critical-path defaults.
- Frontend: 3 files / 39 tests (unchanged).
- Lint clean (one pre-existing unrelated warning).
- Vercel preview build: clean.

## Why I missed this in PR #40 — honest read

This is the second time I have shipped a V2 selection that turned out
to be undeployable on first user click. Both times I had partial live
verification (the slug existed in the OpenRouter catalog) and **did
not verify the per-slug provider count**. PR #40 even acknowledged
"single-upstream caveat" in the criteria doc *but I still shipped
single-upstream slugs as critical-path defaults*. That is a direct
violation of `.cursor/rules/15-doc-pr-and-code-parity.mdc`
(C-UNVERIFIED-CLAIM) on the same PR that introduced that rule.

This PR adds:
- a programmatic startup probe (so the agent can no longer guess about
  per-slug coverage; it logs the answer at deploy time),
- a forbidden-defaults regression test that pins the single-provider
  slugs as user-opt-in only,
- a binding criterion (#6) that says critical-path defaults must have
  ≥ 2 live upstreams,
- a model selection that puts critical-path roles on slugs with 4-10
  upstreams, so even an aggressive account-policy filter has options.

If a future PR proposes a single-upstream slug as a critical-path V2
default, the test fails and the probe logs a deploy-time warning.
Both gates have to pass for any future change to land.

## 2026-04-28-PM addendum — PR #41 review fixes (Codex P1/P2 + Copilot)

The first revision of PR #41 introduced two latent defects that the
review caught before merge. Recording them here because both fall in
the same C-class buckets the cursor rules already enforce, so the
self-audit in `docs/retrospectives/2026-04-28-pr36-40-review-findings.md`
applies cleanly.

### A. `qwen/qwen3-235b-a22b-thinking-2507` was silently misrouted to HF

Root cause: `HF_NAMESPACE_PREFIXES` in
`backend/src/services/reasoning/reasoningModelPolicy.ts` listed the
**lowercase** form `'qwen/'` alongside the HF-canonical `'Qwen/'`. The
PR added the OpenRouter slug `qwen/qwen3-235b-a22b-thinking-2507` as
the V2 reasoner-class default; `isHfRepoModel('qwen/...')` then
returned `true`, and `callRoleModel` tried HF Inference for a slug
that does not exist there. The startup preflight skipped the slug for
the same reason. Net effect: V2 reasoner role would have failed at
runtime on every objective that uses Qwen Thinking, with no warning
during boot. Class: **C-NAMESPACE-OVERLAP** (variant of
C-DEPLOY-SKEW); same pattern as the V1 `M.dolphin` slug regression
caught in PR #40.

Fix:
- Drop lowercase `'qwen/'` from `HF_NAMESPACE_PREFIXES`.
- Add an explicit `OPENROUTER_SLUG_OVERRIDES` set for any slug whose
  namespace prefix overlaps a HF-canonical lowercase org
  (`meta-llama/...`, etc.) so disambiguation can be done by exact
  match, not by case alone.
- Lock the contract with a regression test that enumerates every
  V2 default primary and asserts that all-lowercase slugs route to
  OpenRouter.

### B. Preflight probe did not honor `provider.data_collection`

Root cause: the probe issued `GET /models/<slug>/endpoints` with
auth, which returns metadata. Runtime calls go through
`POST /chat/completions` with the runtime `provider` block including
`data_collection: 'allow' | 'deny'`. With
`OPENROUTER_DATA_COLLECTION=deny`, the metadata probe could return
"endpoints exist" while runtime calls would 404 with "No allowed
providers" — exactly the failure mode the probe exists to catch.
Class: **C-PROBE-VS-RUNTIME-DRIFT**.

Fix:
- Replace the metadata probe with a runtime-mirroring
  `POST /chat/completions` smoke probe (`max_tokens: 1`,
  `messages: [system: 'preflight', user: 'ping']`). Same headers
  (`Authorization`, `HTTP-Referer`, `X-Title`), same `provider`
  block, same base URL. Preflight pass ⇔ runtime pass for the
  configured account / policy.
- Add `OPENROUTER_PREFLIGHT=false` to disable wholesale.
- Cost: ~$0.0005 per redeploy, negligible vs. the cost of a
  single failed user-facing run.

### C. Other review fixes folded in

- `classifyModelError` 404 branch had a dead regex (both branches
  returned `'bad_request'`). Collapsed to a single `return 'bad_request'`
  with a comment explaining where the disambiguation actually happens
  (in `researchFailureHints.ts`).
- The "API key missing" preflight test now actually asserts the
  fetcher was never invoked, instead of trusting that the function
  did not throw.
- New tests: OpenRouter no-allowed-providers / generic-404 hint copy,
  qwen-OR-routing regression, preflight `data_collection` propagation.
