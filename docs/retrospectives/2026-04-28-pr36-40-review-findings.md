# Retrospective — Code review findings on PRs #36–40 (Cursor agent self-audit)

Date: 2026-04-28
Author: Cursor agent (self-audit at user request)
Scope: every Codex / Copilot inline finding on the last five PRs the agent
authored against this repo (PR #36, #37, #38, #39, #40).

The point of this document is **not** to relitigate individual fixes — those
are already merged or pushed on the branch. It is to identify the recurring
*classes* of mistake the agent made, and to commit standing rules
(`/.cursor/rules/*.mdc`) that the agent will read on every future session
in this repo so the same classes do not recur.

---

## 1. Full findings table

| PR | Reviewer | Severity | File:line | Finding (short) | Root-cause class |
|---|---|---|---|---|---|
| #36 | Codex | P1 | `openrouterService.ts:497` | `callRoleModel()` rethrows `NormalizedModelError` immediately, skipping the existing role-fallback path that should fire first. | **C-EARLY-RETURN** — moved an error path higher in the stack without re-checking what depended on the original control flow. |
| #36 | Copilot | — | `openrouterService.ts:426` | `togetherChatEndpoint()` strips trailing slash but `callTogetherChat()` still posts to `${config.together.baseUrl}/chat/completions`, which double-slashes when the env has a trailing `/`. | **C-INPUT-NORM** — assumed callers normalize input strings; never wrote a single normalization function that all callers go through. |
| #36 | Copilot | — | `openrouterService.ts:497` | `NormalizedModelError` rethrow in catch skips the existing `warn`/`error` log lines that the rest of the codebase relies on for upstream failure forensics. | **C-EARLY-RETURN** + **C-LOG-PARITY** — narrowed an error path and lost diagnostic logging that operators were depending on. |
| #36 | Copilot | — | `openrouterService.ts:521` | Fallback-path catch also rethrows `NormalizedModelError` immediately, bypassing the same logging that the primary catch uses. | **C-EARLY-RETURN** + **C-LOG-PARITY**. |
| #37 | Codex | P1 | `researchRetryQueueing.ts:17` | `getJob/remove` does not guard against locked BullMQ jobs — removing an in-flight job throws or leaves Redis state inconsistent. | **C-LIBRARY-CONTRACT** — used a third-party API (BullMQ `Job.remove()`) without reading its own contract about job-lock state. |
| #37 | Copilot | — | `researchRetryQueueing.ts:12` | PR description named the helper `enqueueResearchRetryJob` but the code only exported `enqueueResearchRetryJobWithCleanup`; description ⇄ code drift. | **C-DOC-DRIFT** — wrote PR body before final naming was settled and didn't proofread. |
| #37 | Copilot | — | `routes/research.ts:385` | DB `status='queued'` is written *before* the BullMQ enqueue, so a Redis hiccup leaves the run stuck `queued` with no enqueued job. | **C-WRITE-ORDER** — wrote the DB row that "promises" a downstream side effect before the side effect actually happened. |
| #37 | Copilot | — | `__tests__/researchRetryQueueing.test.ts:14` | New test asserts `remove()` was called, but does not assert the *order* (remove before add). The deduplication bug being fixed depends on order. | **C-TEST-WEAK** — wrote a test that passes when the bug is present. |
| #38 | Codex | P2 | `ResearchPage.tsx:269` | Polled fallback events appended *after* truncation to 150, so on long traces the new event gets thrown away before the user sees it. | **C-WINDOW-MATH** — confused `[new, ...prev].slice(-150)` (drops the new) with `[...prev, new].slice(-150)` (drops the oldest). |
| #38 | Copilot | — | `apiRateLimit.ts:34` | `getAdaptiveRefetchIntervalMs` widens polling to a fixed cooldown but ignores the actual remaining cooldown duration set by the upstream 429 (Retry-After). | **C-IGNORE-UPSTREAM-SIGNAL** — used a hardcoded constant instead of the upstream-supplied retry-after value. |
| #38 | Copilot | — | `ResearchPage.tsx:269` | Same window-math bug as Codex P2 above. | **C-WINDOW-MATH**. |
| #38 | Copilot | — | `ResearchPageV2.tsx:271` | Same window-math bug as Codex P2 above. | **C-WINDOW-MATH**. |
| #39 | Codex | P1 | `researchOrchestrator.ts:789-790` | The thrown `enrichedError` reused pre-budget `failureDetails.{retryable, failureMeta}` instead of the budget-finalized values, so the worker emits `research:failed` instead of `research:aborted` for terminal runs. | **C-MULTI-WRITER** — added a new state computation but kept the old data path feeding the next stage; two sources of truth for the same fact. |
| #39 | Copilot | — | `researchOrchestrator.ts:781` | Same as Codex P1 above. | **C-MULTI-WRITER**. |
| #39 | Copilot | — | `ResearchPageV2.tsx:1238` | `onError(summary)` after a *successful* retry surfaces a false error toast, because `onError` is wired to `addNotification('error', …)` and there's no `onInfo`. | **C-CALLBACK-MISWIRE** — overloaded a callback with success-path data without renaming or splitting it. |
| #39 | Copilot | — | `ResearchPageV2.tsx:69` | `LiveStatus.retrying` variant exists but `classifyLiveStatus()` never returns it — dead branch. | **C-DEAD-CODE** — declared a state variant before the classifier could see the inputs needed to return it. |
| #40 | Codex | P2 | `researchLiveStatus.ts:124` | `deriveRunState` only evaluates retryability inside the `runStatus === 'failed'` branch; a transient websocket failure arriving before the polled row catches up is ignored, and the FailureCard renders no Resume action for the duration of the gap. | **C-RACE-WINDOW** — assumed two sources (websocket + REST poll) update in lockstep; didn't think about the in-between window. |
| #40 | Copilot | — | `routes/research.ts:367` | SELECT references `retry_attempts`/`retry_budget`; if migration 012 hasn't applied, the endpoint 500s instead of degrading to defaults. | **C-DEPLOY-SKEW** — assumed migration applies before the code that reads from it; didn't tolerate the in-between window. |
| #40 | Copilot | — | `routes/research.ts:353` | UPDATE `status='aborted'` on the budget-exhausted defensive path 500s if the enum value isn't deployed yet. | **C-DEPLOY-SKEW**. |
| #40 | Copilot | — | `researchOrchestrator.ts:767` | Fallback UPDATE in `catch (dbErr)` only sets a subset of fields; leaves `failed_stage` unset and `progress_*` stale, which the polling path reads. | **C-FALLBACK-DRIFT** — wrote a fallback path that was almost-but-not-quite a copy of the primary path; the missing fields matter for downstream readers. |
| #40 | Copilot | — | `runStateMachine.ts:17` | Header doc references `decideRunStateOnSuccess` / `decideRunStateOnCancel` and `frontend/src/utils/runState.ts`, none of which exist. | **C-DOC-DRIFT** — wrote a header that described an aspirational API instead of the API that actually shipped. |
| #40 | Copilot | — | `reasoningModelPolicy.ts:98` | New `isHfRepoModel()` no longer routes `cognitivecomputations/dolphin-2.9.2-qwen2-72b` through HF; V1 ensemble still uses that slug, so V1 calls would silently switch to OpenRouter (where the slug doesn't exist) → silent V1 regression. | **C-RIPPLE** — changed a routing primitive without grepping for every remaining caller of the old behavior. |

Total inline findings on the last five PRs: **22** (1 P1 from #36, 1 P1 from #37, 1 P2 from #38, 1 P1 from #39, 1 P2 from #40, plus 17 lower-severity Copilot findings). Of the 22, **all 22 were valid bugs in the patch.** None were spurious / false-positive.

> Beyond the inline findings: an additional class of mistake came up in PR #40 that no reviewer caught but the user did — model selections on PR #40 were claimed to be "OpenRouter, multi-provider redundant," but live verification on 2026-04-28 showed most are single-upstream on OpenRouter (Nebius / DeepInfra / Venice). This is **C-UNVERIFIED-CLAIM** — assertion shipped in a doc/PR body that was not verified against the actual external system. Added to the rules below.

---

## 2. Recurring failure patterns

Of the 22 inline findings (plus the unverified claim), 8 distinct
root-cause classes account for everything. Several findings exemplify the
same class:

| Class | Count | Definition |
|---|---|---|
| **C-MULTI-WRITER** | 2 | Same fact computed in two places; computations diverge under load or boundary conditions. |
| **C-EARLY-RETURN** / **C-LOG-PARITY** | 3 | Narrowed an error path (e.g. `throw` instead of `catch + handle`) and lost the diagnostic logging or fallback step the rest of the system depended on. |
| **C-WINDOW-MATH** | 3 | Off-by-one or "which end of the array do I drop" error in trace / event windowing. |
| **C-RACE-WINDOW** | 2 | Assumed two async sources update in lockstep; didn't think about the gap. (Includes deploy-skew between code and migration.) |
| **C-DEPLOY-SKEW** | 2 | Assumed a schema/enum change is in place before the code that depends on it; no graceful degradation when it isn't yet. |
| **C-DOC-DRIFT** | 2 | PR body / header comment / readme described an API or behavior that didn't ship. |
| **C-FALLBACK-DRIFT** | 1 | Wrote a fallback DB UPDATE that was almost-but-not-quite a copy of the primary, missing fields the readers depend on. |
| **C-CALLBACK-MISWIRE** | 1 | Overloaded a callback with success-path data when it was wired only to error notifications. |
| **C-DEAD-CODE** | 1 | Declared a state / type variant that the producing function never emits. |
| **C-WRITE-ORDER** | 1 | DB row that "promises" a side effect was written before the side effect happened. |
| **C-INPUT-NORM** | 1 | Trailing-slash-style input normalization done at one site but not centralized; other sites still had the bug. |
| **C-LIBRARY-CONTRACT** | 1 | Called a third-party API (BullMQ `Job.remove()`) without reading its contract for in-flight / locked state. |
| **C-RIPPLE** | 1 | Changed a primitive (`isHfRepoModel`) without grepping for every remaining caller of the old behavior. |
| **C-TEST-WEAK** | 1 | New test passes when the bug being fixed is present (asserted "X was called" but not "X was called *before* Y"). |
| **C-UNVERIFIED-CLAIM** | 1 | Shipped an external-system claim in a PR body / doc without verifying it against the actual external system. |

Total: **22 inline findings + 1 unverified-claim finding = 23**, mapped to **15 classes**, of which **8 classes** account for **18 of 23 = ~78% of the findings**: `C-MULTI-WRITER`, `C-EARLY-RETURN/LOG-PARITY`, `C-WINDOW-MATH`, `C-RACE-WINDOW`, `C-DEPLOY-SKEW`, `C-DOC-DRIFT`, `C-FALLBACK-DRIFT`, `C-UNVERIFIED-CLAIM`.

---

## 3. Honest read on why the agent missed these

Most are **mechanical pre-commit oversights**, not deep design errors:

1. **No checklist before pushing.** When the patch typechecks and the
   tests pass, the agent commits. The patch was right *locally*; it
   wasn't checked against the surrounding async / deploy / log /
   third-party-API context.
2. **Trusted the diff alone, not the full file.** Several findings
   (deploy-skew, multi-writer, ripple, fallback-drift) are visible only
   when you read the *whole* function or grep for every caller of a
   primitive you just changed.
3. **Wrote PR bodies / docs while implementing.** Doc and code drifted
   because the agent didn't re-read the body against the final code
   before pushing the last commit.
4. **Treated tests as a syntax check, not a behavior pin.** Several
   tests passed both with and without the bug. Tests need to *fail* in
   the absence of the fix.
5. **Did not verify external-system claims live.** PR #39 and PR #40
   both shipped a model-selection claim that was demonstrably wrong on
   first deploy.

---

## 4. Standing rules added in this PR

The rules below are now committed to `.cursor/rules/`. Cursor reads
`.cursor/rules/*.mdc` automatically on every agent session in this
repo, so the agent will see them before starting any new work.

| Rule file | Pattern it prevents |
|---|---|
| `.cursor/rules/00-pre-commit-review.mdc` | Master checklist the agent runs before every `git commit` and `git push`. |
| `.cursor/rules/10-state-machine-and-multi-writer.mdc` | C-MULTI-WRITER, C-RACE-WINDOW |
| `.cursor/rules/11-error-paths-and-logging.mdc` | C-EARLY-RETURN, C-LOG-PARITY, C-CALLBACK-MISWIRE |
| `.cursor/rules/12-event-window-math.mdc` | C-WINDOW-MATH |
| `.cursor/rules/13-deploy-skew-and-schema.mdc` | C-DEPLOY-SKEW, C-FALLBACK-DRIFT, C-WRITE-ORDER |
| `.cursor/rules/14-third-party-api-contracts.mdc` | C-LIBRARY-CONTRACT, C-INPUT-NORM |
| `.cursor/rules/15-doc-pr-and-code-parity.mdc` | C-DOC-DRIFT, C-UNVERIFIED-CLAIM |
| `.cursor/rules/16-tests-must-fail-without-the-fix.mdc` | C-TEST-WEAK |
| `.cursor/rules/17-ripple-and-grep-callers.mdc` | C-RIPPLE, C-DEAD-CODE |
| `.cursor/rules/20-research-policy-guardrails.mdc` | Repo-specific: epistemic policy + V2 model selection criteria. |

The rules are intentionally *short*. They do not try to teach the agent
to be a different model — they encode "before you push, run this
checklist." Each rule has a few bullet points the agent can mentally
walk through in 30 seconds, plus a `## Examples` section pinned to the
real findings above so the rule is concrete, not abstract.
