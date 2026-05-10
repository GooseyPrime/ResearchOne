# Research orchestrator ↔ run state machine (review notes)

This document captures the deferred “end-to-end state machine review” for `runResearchJob` in `backend/src/services/reasoning/researchOrchestrator.ts`.

## Canonical writer (backend)

- **`decideRunStateOnFailure`** (`backend/src/services/reasoning/runStateMachine.ts`) classifies terminal failures: status (`failed` vs `aborted`), `failure_meta` (including retry budget / terminal flags), and derived retry hints.
- The orchestrator **must** persist exactly the `failure_meta` / status produced by that decision before emitting the same payload on the websocket or rethrowing to the worker. Divergence here was the root cause class in PR #39 (multi-writer bug).

## Canonical reader (frontend)

- **`deriveRunState`** (`frontend/src/utils/researchLiveStatus.ts`) reconciles polled DB rows with transient websocket failures. Any new run status or `failure_meta` shape should be threaded through this single reader.

## Checklist when touching failure paths

1. Identify every **writer** of `research_runs.status`, `failure_meta`, `failed_stage`, and progress columns (orchestrator catch blocks, retry route, cancellation, admin repair jobs).
2. Confirm each failure path calls **`decideRunStateOnFailure`** (or intentionally bypasses it with an inline comment explaining why).
3. Confirm defensive DB updates in nested `catch (dbErr)` **mirror** the primary UPDATE (see `.cursor/rules/13-deploy-skew-and-schema.mdc`).
4. Grepping **`decideRunStateOnRetryRequest`** and **`enqueueResearchRetryJobWithCleanup`** callers after any retry contract change.
