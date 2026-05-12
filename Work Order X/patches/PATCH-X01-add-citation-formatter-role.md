# PATCH X01 — `reasoningModelPolicy.ts`: add `citation_formatter` to `REASONING_MODEL_ROLES`

**File:** `backend/src/services/reasoning/reasoningModelPolicy.ts`
**Why:** The formatting engine occasionally needs an LLM to choose the
optimal in-text citation phrasing when source metadata is incomplete
— e.g. a source with no `published_at` should render as "(Author,
n.d.)" in APA but the alternative inference paths (parse date from
URL, use ingested_at as accessed-date, fall back to "no date") need
a judgement call. `citation_formatter` is that role.

**⚠️ CROSS-WO CONTRACT — see PATCH-X02.**
Per Cursor rule 25 invariant I-9, this patch MUST land in the SAME
commit as PATCH-X02 which adds the matching `rolePhaseFor()` case in
`backend/src/services/telemetry/costSidecar.ts`. The pre-commit grep
in Rule 28 I-1 enforces this:

```bash
git diff --name-only | grep -E "reasoningModelPolicy\.ts|costSidecar\.ts"
```

Both files must appear in the diff. If either is absent, the cost
analytics dashboard will bucket `citation_formatter` cost as "Other"
and the new Citation Mapping phase will appear empty in the cost
breakdown chart.

---

## Step 1 — Add `'citation_formatter'` to the canonical list

Find the existing constant at line 6 of `reasoningModelPolicy.ts`:

```ts
export const REASONING_MODEL_ROLES = [
  'planner',
  'retriever',
  'reasoner',
  'skeptic',
  'synthesizer',
  'verifier',
  'plain_language_synthesizer',
  'outline_architect',
  'section_drafter',
  'internal_challenger',
  'coherence_refiner',
  'revision_intake',
  'report_locator',
  'change_planner',
  'section_rewriter',
  'citation_integrity_checker',
  'final_revision_verifier',
] as const;
```

**Append `'citation_formatter'`** at the end of the list (before the
closing `]`):

```ts
export const REASONING_MODEL_ROLES = [
  'planner',
  'retriever',
  'reasoner',
  'skeptic',
  'synthesizer',
  'verifier',
  'plain_language_synthesizer',
  'outline_architect',
  'section_drafter',
  'internal_challenger',
  'coherence_refiner',
  'revision_intake',
  'report_locator',
  'change_planner',
  'section_rewriter',
  'citation_integrity_checker',
  'final_revision_verifier',
  'citation_formatter',   // ← ADD — WO-X. See PATCH-X02 for matching rolePhaseFor case.
] as const;
```

**Order matters:** existing roles are NOT reordered. Per the file's
header comment, "Order is stable for UI and DB; do not rename without
updating call sites and migrations." Append only.

## Step 2 — Add the model config entries

The same file (around lines 80–280) maps each role to its default and
fallback models in `getReasoningModelPolicy()`. Find the
`ROLE_MODEL_DEFAULTS` and add an entry:

```ts
const ROLE_MODEL_DEFAULTS: Record<ReasoningModelRole, readonly string[]> = {
  // ... existing entries ...
  citation_formatter: [
    'openai/o4-mini',            // cheap, structured-output-friendly
    'openai/gpt-4o-mini',        // fallback
  ],
};
```

(The exact existing structure may differ — read the file end-to-end
per Cursor rule 00. The key is that whatever pattern the other roles
use, `citation_formatter` gets the same shape with cheap-extractor-
class models. It is NOT a reasoner-class job.)

## Step 3 — Verify

```bash
cd backend
npx tsc --noEmit
```

TypeScript will fail to compile if you broke the const-tuple type
inference for `ReasoningModelRole`. Fix any consumer that uses
exhaustive switch — most should be covered by `rolePhaseFor()` (PATCH-X02
adds the case) but `reasoningModelPolicy.ts:ROLE_MODEL_DEFAULTS` is
typed `Record<ReasoningModelRole, ...>` and will demand the new key.

```bash
npx vitest run reasoningModelPolicy
```

Existing tests should pass with the new role appended — additive
change to a const tuple.

## Why a new role, not a callPurpose tag

We considered routing this work through an existing role (e.g.
`verifier` with `callPurpose: 'citation_formatting'`). Reasons against:

1. **Different model tier.** Citation formatting is structured output
   from limited input — a small fast model (gpt-4o-mini class) is
   plenty. Routing through `verifier` would charge it to the verifier
   model policy, which currently points at a heavier reasoner-class
   model.
2. **Cost attribution.** Per Rule 25 I-9, phase = role + callPurpose.
   The `citation_formatter` role gives the analytics dashboard a
   clean axis for "how much did formatting cost us this month."
   Hiding it inside `verifier` mixes the signal.
3. **Failure isolation.** When citation formatting fails (or hits a
   provider outage), the orchestrator's retry policy is different
   from the verifier's. Distinct role = distinct policy.

## Test consequence

Add to `backend/src/__tests__/costSidecar.test.ts` — INSIDE the
existing `describe('costSidecar — rolePhaseFor')` block:

```ts
it('citation_formatter maps to Citation Mapping (WO-X / Rule 25 I-9 cross-WO)', () => {
  expect(rolePhaseFor('citation_formatter')).toBe('Citation Mapping');
  // REVERT-CHECK: PATCH-X02 — the `case 'citation_formatter'` line
  // in costSidecar.ts:rolePhaseFor. Without it, the role buckets
  // as 'Other' and the cross-WO contract breaks.
});
```

This is the load-bearing test of the entire 4-WO package: it
mechanically asserts the contract you've been wiring across WO-U and
WO-X is intact.
