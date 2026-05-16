# PR #133 — Copilot and Codex (chatgpt-codex-connector) review disposition

**Date:** 2026-05-15  
**Context:** Research V1/V2 parity, shared live trace, `run:summary` wiring, dossier navigation.

This note records each automated review theme, how it maps to repo rules, and what we shipped or deferred so future sessions can grep one file instead of re-deriving from GitHub.

## Recommendation log

| Source | Theme | Rule alignment | Disposition |
|--------|--------|----------------|-------------|
| **Copilot** | `ResearchPage` polled `getResearchRun` every ~4s while `trackedRun.status === 'failed'`, redundant with 8s list refetch and REST summary fallback. | **Rule 10** (multiple async writers); avoid pointless traffic on terminal rows. | **Accepted:** keep `useQuery` **enabled** whenever `trackingRunId` is set (so cache refetch / invalidation still works), but set **`refetchInterval` to `false`** unless status is `running` or `queued`. On `research:failed` / `research:aborted` and when the list row shows terminal `failed`/`aborted`, invalidate `['research-run', id]` once so a missed socket still hydrates `polledRun` without a 4s loop. |
| **Copilot** | `onRetried` updated `trackingRunId` but not `lastKnownRunIdRef`; `run:summary` and REST fallback gate on `lastKnownRunIdRef`. | **Rule 10** (ref vs React state drift; multi-writer consistency). | **Accepted:** `onRetried` sets `lastKnownRunIdRef.current = rid`, clears summary flags, `subscribeToJob(rid)`, and invalidates `['research-run', rid]`. Resume uses the same `runId`, but the ref write removes ambiguity for any future path that might pass a different id. |
| **Codex (P2)** | On “Resume from last failure”, stale `runSummary` / `runSummaryReceivedRef` could show the previous failure summary or block fresh telemetry during retry. | **Rule 10** (same run, new lifecycle segment; treat summary as tied to the failure segment). | **Accepted:** clear `runSummary`, set `runSummaryReceivedRef` false before refetch/notifications (mirrors `mutation.onSuccess` for a new run). |
| **Codex (P2)** | `LiveResearchTraceLog` omitted `ResearchProgressEvent.detail` — regression vs inline V1 trace that exposed expandable diagnostics. | **Rule 11** (preserve diagnostic surface for operators); not a PolicyOne / preamble change. | **Accepted:** render `detail` under the primary message when present; unit test asserts visible text. |
| **Codex (implied parity)** | V2 `RunRow` `onRemoved` did not clear `runSummary` when clearing the tracked run (V1 did). | **Rule 10** / **Rule 23**-style symmetry across sibling surfaces. | **Accepted:** V2 `onRemoved` now clears `runSummary` like V1. |

## Not in scope for this follow-up

- Merging `ResearchPage` and `ResearchPageV2` (explicitly deferred earlier).
- Any change to **Rule 20** fenced prompts or V2 default models.

## Files touched by the follow-up commit

- `frontend/src/pages/ResearchPage.tsx` — poll cadence gating, terminal `research-run` invalidation, `onRetried` wiring.
- `frontend/src/pages/ResearchPageV2.tsx` — `onRetried` wiring, `onRemoved` summary cleanup.
- `frontend/src/components/research/LiveResearchTraceLog.tsx` — `detail` rendering.
- `frontend/src/components/research/LiveResearchTraceLog.test.tsx` — regression guard for `detail`.
