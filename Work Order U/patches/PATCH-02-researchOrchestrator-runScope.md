# PATCH 02 — `researchOrchestrator.ts`: wrap `runResearchJob` in `runScope.run`

**File:** `backend/src/services/reasoning/researchOrchestrator.ts`
**Why:** Establishes the AsyncLocalStorage scope so every nested
`callRoleModel` (including the ones inside `runDiscoveryOrchestrator`,
`generateIterativeReport`, `extractAndPersistClaims`,
`extractAndPersistContradictions`, `mapAndPersistCitations`) inherits
`runId`, `userId`, and `orgId` automatically. Per Rule 25 invariant I-2.

**Behavioral guarantee:** Wrapping the entire function body in
`runScope.run(...)` is **functionally a no-op** for any code that
doesn't read from `runScope`. Every existing `await`, every existing
`progress(...)` call, every `query(...)` is unchanged. AsyncLocalStorage
preserves context across all `await`s, so an `await` deep inside
`generateIterativeReport` still sees the scope set at the top of
`runResearchJob`.

---

## Step 1 — Add the import

Find the existing imports near the top of the file (lines 1–32). Add to
the end of the block:

```ts
import { runScope } from '../telemetry';
```

## Step 2 — Inner-function split

The function currently declared at line 183 is:

```ts
export async function runResearchJob(
  data: ResearchJobData,
  onProgress: ProgressCallback
): Promise<{ runId: string; reportId: string; summary?: RunSummaryPayload }> {
  const {
    runId,
    query: researchQuery,
    // ... ~1200 lines of body ...
  };
}
```

We cannot enter `AsyncLocalStorage` scope mid-function — it must wrap
the function call. Standard pattern: rename the existing function to
an inner private function, and the public export becomes a thin
wrapper.

**Rename the existing declaration** from:

```ts
export async function runResearchJob(
  data: ResearchJobData,
  onProgress: ProgressCallback
): Promise<{ runId: string; reportId: string; summary?: RunSummaryPayload }> {
```

**to:**

```ts
async function runResearchJobInner(
  data: ResearchJobData,
  onProgress: ProgressCallback
): Promise<{ runId: string; reportId: string; summary?: RunSummaryPayload }> {
```

**Then ADD a new public wrapper immediately above the renamed function:**

```ts
/**
 * Public entry point. Establishes the cost-telemetry run scope so all
 * nested `callRoleModel` calls (orchestrator, discovery, report
 * generator, extractors) emit `agent_executions` rows tagged with the
 * correct run / user / org. The inner function is `runResearchJobInner`
 * — do not call it directly.
 *
 * Per Rule 25 invariant I-2: only this function (plus the analogous
 * wrappers in discoveryOrchestrator, reportRevisionService) may call
 * `runScope.run`.
 */
export async function runResearchJob(
  data: ResearchJobData,
  onProgress: ProgressCallback
): Promise<{ runId: string; reportId: string; summary?: RunSummaryPayload }> {
  return runScope.run(
    {
      runId: data.runId,
      userId: data.creditChargeContext?.userId ?? null,
      orgId: null,  // ResearchJobData does not currently carry orgId;
                    // add via WO-K's RLS extension if/when needed.
      reportId: null,  // assigned mid-run; the orchestrator updates
                       // scope when reportId becomes known (Step 3).
    },
    () => runResearchJobInner(data, onProgress)
  );
}

```

## Step 3 — Update scope when `reportId` becomes known

Mid-run, the orchestrator creates a `reports` row (a new `reportId`)
before the synthesis stage. Calls that happen AFTER that point should
emit with the reportId attached.

Locate the line in `runResearchJobInner` where `reportId` is first
assigned to a non-null value. In the May 2026 snapshot this is around
line 690–700 where the orchestrator INSERTs the report row and gets
back its UUID. Look for a pattern like:

```ts
const reportId = await createReport(...);
// or
const reportRows = await query<{ id: string }>(`INSERT INTO reports ... RETURNING id`, [...]);
const reportId = reportRows[0].id;
```

**Immediately after `reportId` is assigned, add:**

```ts
    // Update telemetry scope so subsequent agent_executions rows carry the report_id.
    // AsyncLocalStorage doesn't support mutating the current store directly;
    // we wrap the remainder of the function in a nested scope that inherits
    // the existing runId/userId and adds reportId.
    //
    // NOTE: This is a small structural change — the remainder of the pipeline
    // (verifier, plain language synthesizer, epistemic persistence) executes
    // INSIDE the nested .run() block. Cursor: keep the existing logic
    // untouched; only the wrapping changes.
```

**Decision required at Cursor implementation time:** the cleanest way to
do this is to extract the post-reportId portion of the pipeline into a
local helper:

```ts
const postReportPhases = async () => {
  // ... everything from "verifier stage" through epistemic persistence ...
};

await runScope.run(
  { ...runScope.current(), reportId },
  postReportPhases
);
```

Alternatively, you can accept that the verifier/plain-language-synthesizer
calls won't carry `report_id` (only `run_id`) — the admin dashboard can
JOIN `agent_executions.run_id` → `reports.run_id` to recover the
reportId post-hoc. **This is the pragmatic choice for the initial
implementation:** skip Step 3 entirely and let the dashboard do the
JOIN. The schema supports it (idx_agent_executions_run is already
defined), and it avoids restructuring 100+ lines of orchestrator code.

**Recommendation: implement Step 3 only if the admin dashboard's
report-page-cost query is measurably slow.** YAGNI.

## Step 4 — Verify

```bash
cd backend
npx tsc --noEmit
npx vitest run runStateMachine    # ensure orchestrator integration tests still pass
npx vitest run pipelineBEligibility
```

Grep to confirm only the one wrapper has been added:

```bash
grep -n "runScope.run" backend/src/services/reasoning/researchOrchestrator.ts
# Expected: exactly one hit in the new public wrapper (line ~183).
```

## Test consequence

A regression test in `__tests__/costSidecar.test.ts` should:

- Call `runResearchJob({runId: 'r1', creditChargeContext: {userId: 'u1', ...}, ...})`
  with mocked LLM responses.
- Assert that every `agent_executions` row created during the run has
  `run_id='r1'` AND `user_id='u1'`.
- Mentally revert Step 2: the rows would have `run_id=NULL` because no
  scope was established. The test must fail without this patch. ✓
