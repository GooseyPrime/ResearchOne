# PATCH X02 — `costSidecar.ts`: `rolePhaseFor` adds `citation_formatter`

**File:** `backend/src/services/telemetry/costSidecar.ts`
**Why:** This is the **load-bearing cross-WO contract** between WO-U
and WO-X. Per Cursor rule 25 invariant I-9, adding a new
`ReasoningModelRole` requires adding its phase mapping in the same
commit. PATCH-X01 adds the role; this patch adds the matching phase
case.

The two patches MUST land together. The pre-commit grep in Rule 28
I-1 mechanically enforces this:

```bash
git diff --name-only | grep -E "reasoningModelPolicy\.ts|costSidecar\.ts"
# Both files must be in the diff.
```

If you find yourself wanting to ship PATCH-X01 without this patch
because "the formatting engine isn't live yet, the role doesn't fire
yet" — don't. The whole point of the I-9 invariant is that the role
and its phase mapping are co-canonical. Ship them together; the new
role just won't fire until PATCH-X03 lands the orchestrator. That's
fine.

---

## Step 1 — Add the case

Find `rolePhaseFor` in `backend/src/services/telemetry/costSidecar.ts`
(around line 90 in the WO-U snapshot):

```ts
export function rolePhaseFor(role: string, callPurpose?: string): PipelinePhase {
  // Call-purpose overrides win first.
  if (callPurpose === 'pipeline_skeptic') return 'Skeptic';
  if (callPurpose === 'contradiction_extraction') return 'Contradiction Extraction';

  switch (role) {
    case 'planner':
      return 'Planning';
    case 'retriever':
      return 'Retrieval';
    case 'reasoner':
      return 'Reasoning';
    case 'skeptic':
    case 'internal_challenger':
      return 'Skeptic';
    case 'synthesizer':
    case 'outline_architect':
    case 'section_drafter':
    case 'coherence_refiner':
      return 'Synthesis';
    case 'verifier':
    case 'citation_integrity_checker':
    case 'final_revision_verifier':
      return 'Verification';
    case 'plain_language_synthesizer':
      return 'Plain Language';
    case 'revision_intake':
    case 'report_locator':
    case 'change_planner':
    case 'section_rewriter':
      return 'Revision';
    default:
      return 'Other';
  }
}
```

**Add a case for `citation_formatter`** before the `default:` arm:

```ts
    case 'revision_intake':
    case 'report_locator':
    case 'change_planner':
    case 'section_rewriter':
      return 'Revision';
    case 'citation_formatter':         // ← ADD — WO-X / Rule 25 I-9.
      return 'Citation Mapping';
    default:
      return 'Other';
```

## Step 2 — That's it

This is a one-case addition. There is no Step 3.

The `'Citation Mapping'` phase is already defined in the
`PipelinePhase` enum at the top of the same file (WO-U shipped it
intentionally for this exact future contract — see the WO-U Cursor
rule 25 I-9 comment about explicit composition with WO-X).

## Verify

```bash
cd backend
npx tsc --noEmit                       # exhaustive switch typecheck
npx vitest run costSidecar              # the existing rolePhaseFor tests
```

After PATCH-X01 + this patch, run the new test added by PATCH-X01's
documentation:

```bash
npx vitest run "citation_formatter maps to Citation Mapping"
```

This MUST pass with both patches in place AND fail if EITHER is reverted
— the load-bearing assertion of the entire 4-WO package's composition.

## Dashboard impact after this lands

Once a single export job runs and the `citation_formatter` role fires,
the next refresh of `/app/admin/cost`:

- **Phase breakdown pie chart** shows a new "Citation Mapping" slice
  with non-zero cost. Until that point the slice is absent because no
  rows exist; this is correct behavior (no work = no cost).
- **Per-run cost table's `topPhase` column** may show "Citation
  Mapping" for export-heavy reports — that's the cost dashboard
  telling you a report's formatting cost more than its reasoning.
  Useful signal.
- **Pre-commit greps that depend on this case being present** include
  the Rule 25 I-9 mechanical check; PRs that touch the role list but
  not this case will fail review.

## Why this patch is only ~10 lines but matters more than most

The mechanical contract (role list + phase map = same commit) is the
working theory of how the 4 WOs compose. Any subsequent role addition
(WO-Y, WO-Z, ...) replays this exact pattern.

If PATCH-X02 lands cleanly:

1. The "same-commit constraint" works in practice, not just in theory.
2. The next role addition can reference this patch as precedent.
3. The cost dashboard's promise — "every dollar of LLM spend is
   attributed to a labeled pipeline phase" — holds.

If PATCH-X02 ships separately from PATCH-X01:

1. The cost dashboard silently mis-attributes `citation_formatter`
   spend to "Other" for however many deploys it takes to notice.
2. Future role additions reference a broken precedent.
3. Operators investigating "why is Other 8% of cost this week" trace
   it back here and lose trust in the analytics.

So: same commit. Always.
