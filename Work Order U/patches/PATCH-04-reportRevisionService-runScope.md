# PATCH 04 — `reportRevisionService.ts`: wrap `createReportRevision` in `runScope.run`

**File:** `backend/src/services/reasoning/reportRevisionService.ts`
**Why:** The revision pipeline is a **separate top-level entry point**
from the research orchestrator — invoked by the
`livingReportRevisionWorker` (WO-T) and by the manual revision API
route. It is not nested under `runResearchJob`, so it must establish
its own telemetry scope.

**Critical scope decision (per ADR `docs/COST_SIDECAR_DESIGN.md`):**

Revision cost belongs to the *report* being revised, not to a new
research run. The revision pipeline does not create a `research_runs`
row — it creates `report_revisions`. Therefore:

- `runId` is set to `NULL` for revision-emitted rows (intentional).
- `reportId` is set to the report being revised.
- `userId` is the initiator from `args.initiatedBy`.

The admin dashboard's "cost per report" query already accounts for
this: `report_cost_summary` view groups by `report_id` regardless of
whether the rows originated from research or revision.

---

## Step 1 — Add the import

In the existing imports block (line 1–7):

```ts
import { runScope } from '../telemetry';
```

## Step 2 — Wrap `createReportRevision`

The function declared at line 192:

```ts
export async function createReportRevision(args: {
  reportId: string;
  requestText: string;
  // ... 20 lines of arg signature ...
}): Promise<{ revisionId: string; revisedReportId: string; changePlan: ChangePlan }> {
  const emit = (stage: string, percent: number, message: string, revisionId?: string) => {
    // ...
  };
  // ... ~570 lines of body through line ~760 ...
}
```

**Rename to `createReportRevisionInner`** and **add a wrapper above it:**

```ts
/**
 * Public entry. Establishes telemetry scope for the revision pipeline.
 *
 * Revision-emitted `agent_executions` rows have:
 *   run_id    = NULL    (revisions don't create research_runs rows)
 *   report_id = args.reportId  (the report being revised)
 *   user_id   = args.initiatedBy
 *
 * Per Rule 25 invariant I-2: only this function may call runScope.run
 * inside the revision module. The seven revision agents (revision_intake,
 * report_locator, change_planner, section_rewriter, citation_integrity_checker,
 * final_revision_verifier — see REASONING_MODEL_ROLES) inherit this scope
 * via AsyncLocalStorage.
 */
export async function createReportRevision(args: {
  reportId: string;
  requestText: string;
  rationale?: string;
  initiatedBy?: string;
  initiatedByType?: string;
  revisionTriggeredBy?: RevisionTriggerSource;
  supplementalContext?: string;
  supplementalAttachments?: Array<Record<string, unknown>>;
  onProgress?: (update: RevisionProgress) => void;
  requestId?: string;
}): Promise<{ revisionId: string; revisedReportId: string; changePlan: ChangePlan }> {
  return runScope.run(
    {
      runId: null,
      reportId: args.reportId,
      userId: args.initiatedBy ?? null,
      orgId: null,
    },
    () => createReportRevisionInner(args)
  );
}

async function createReportRevisionInner(args: {
  // ... identical signature to original ...
}): Promise<{ revisionId: string; revisedReportId: string; changePlan: ChangePlan }> {
  // ... original body unchanged ...
}
```

## Step 3 — `revisedReportId` lineage (deferred, see ADR)

A revision produces a NEW report row (`args.revisedReportId` in the
return). The agent calls that happen DURING the revision targeted the
ORIGINAL report (`args.reportId`); they should stay tagged to it,
which is what Step 2 does. If a later WO wants to also tag rows with
the resulting new-report id for lineage analytics, add a
`metadata.revised_report_id` field via a follow-up.

For this WO: don't try to be clever about lineage. The original
report is the cost-attribution anchor — same as Cursor rule 17
ripple-and-grep, do the minimum that's clearly correct.

## Step 4 — Verify

```bash
cd backend
npx tsc --noEmit
npx vitest run reportRevisionService
npx vitest run revision_via_monitor_uses_same_prompts
```

Grep:

```bash
grep -n "runScope.run" backend/src/services/reasoning/
# Expected:
#   1. researchOrchestrator.ts (from PATCH 02)
#   2. reportRevisionService.ts (this patch)
# That's it. Two hits.
```

## Test consequence

In `__tests__/costSidecar.test.ts`:

- Call `createReportRevision({reportId: 'rep1', initiatedBy: 'u1', ...})`
  with mocked LLM responses.
- Assert all resulting `agent_executions` rows have:
  - `run_id IS NULL` ✓
  - `report_id='rep1'` ✓
  - `user_id='u1'` ✓
  - `agent_role` in the revision-role set (revision_intake,
    report_locator, change_planner, section_rewriter,
    citation_integrity_checker, final_revision_verifier).
  - `phase` is `'Revision'` for the workflow roles and `'Verification'`
    for the integrity checker / final verifier (per
    `rolePhaseFor` mapping).
- Mentally revert this patch: rows would have `report_id IS NULL` (no
  scope set). The test must fail. ✓
