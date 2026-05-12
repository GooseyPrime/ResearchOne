# PATCH 05 — Inherited-scope sites: `reportGenerator`, `claimExtractor`, `contradictionExtractor`, `citationMapper`

**Files (no edits — verification only):**

- `backend/src/services/reasoning/reportGenerator.ts`
- `backend/src/services/reasoning/claimExtractor.ts`
- `backend/src/services/reasoning/contradictionExtractor.ts`
- `backend/src/services/reasoning/citationMapper.ts`

**Why this patch is a no-op:** All four of these files contain
`callRoleModel` invocations, but each is called transitively from
either `runResearchJob` (PATCH 02 scope) or `createReportRevision`
(PATCH 04 scope). AsyncLocalStorage propagates the active scope across
all `await` boundaries automatically. **No code change is required.**

This patch exists so that Cursor's grep-for-callRoleModel exercise (per
Cursor rule 17) confirms every call site is accounted for and the
inheritance assumption holds.

---

## Verification matrix

| Service | Function | Called from | Inherits scope from |
|---|---|---|---|
| `reportGenerator.ts:150` (outline_architect) | `generateIterativeReport` | `researchOrchestrator.ts` line ~602 (or similar) | PATCH 02 |
| `reportGenerator.ts:182` (section_drafter) | `generateIterativeReport` | same | PATCH 02 |
| `reportGenerator.ts:210` (internal_challenger) | `generateIterativeReport` | same | PATCH 02 |
| `reportGenerator.ts:224` (coherence_refiner) | `generateIterativeReport` | same | PATCH 02 |
| `claimExtractor.ts:80` (configurable role) | `extractAndPersistClaims` | `researchOrchestrator.ts` | PATCH 02 |
| `contradictionExtractor.ts:84` (configurable role) | `extractAndPersistContradictions` | `researchOrchestrator.ts` | PATCH 02 |
| `citationMapper.ts:95` (configurable role) | `mapAndPersistCitations` | `researchOrchestrator.ts` | PATCH 02 |

## How to verify (Cursor: run these in order)

### Step 1 — Confirm every callRoleModel call is reachable from a scope

```bash
grep -rn "callRoleModel" backend/src --include='*.ts' \
  | grep -v __tests__ \
  | grep -v ".test.ts" \
  | grep -v "telemetry/" \
  | grep -v "openrouterService.ts"
```

Expected matches (May 2026 main snapshot — line numbers will drift as
the codebase evolves):

```
backend/src/services/reasoning/reportRevisionService.ts:2
backend/src/services/reasoning/reportRevisionService.ts:339,352,370,419,469,498
backend/src/services/reasoning/reportGenerator.ts:1
backend/src/services/reasoning/reportGenerator.ts:150,182,210,224
backend/src/services/reasoning/contradictionExtractor.ts:8,84
backend/src/services/reasoning/claimExtractor.ts:9,80
backend/src/services/reasoning/citationMapper.ts:11,95
backend/src/services/reasoning/researchOrchestrator.ts:4,314,466,491,516,573,602
backend/src/services/discovery/discoveryOrchestrator.ts:23,150,290
```

For **every** match: trace the function it's in back up to either
`runResearchJob` or `createReportRevision` (or
`runDiscoveryOrchestrator`, which is itself wrapped by PATCH 03). If
any path doesn't lead to one of those three, that call site needs
its own scope wrap — escalate before continuing.

### Step 2 — Confirm `contradiction_extraction` callPurpose is set

The contradiction extractor at `contradictionExtractor.ts:84` should
pass `callPurpose: 'contradiction_extraction'` in its
`callRoleModel(...)` options. Without that, the cost dashboard will
attribute contradiction extraction work to the wrong phase (it'll
fall back to `rolePhaseFor(role)` instead of getting the
`'Contradiction Extraction'` override).

Read `contradictionExtractor.ts:80–90` and confirm:

```ts
const result = await callRoleModel({
  role: 'reasoner',     // or whichever role is current
  callPurpose: 'contradiction_extraction',   // ← MUST be present
  // ...
});
```

If `callPurpose` is missing, **this is an out-of-scope finding** per
Cursor rule 22 — add it in the same PR with a one-line justification:
"so cost analytics attributes contradiction-extraction tokens to the
Contradiction Extraction phase, not Reasoning."

### Step 3 — Confirm `pipeline_skeptic` callPurpose is set

The orchestrator's skeptic call at `researchOrchestrator.ts:516–530`
already sets `callPurpose: 'pipeline_skeptic'` (confirmed in the May
2026 snapshot, line 519). Verify it's still there post-merge.

Without that, the cost dashboard would attribute Skeptic phase work
to whichever role the skeptic call uses — which is `'skeptic'`, which
maps to Phase=Skeptic regardless of callPurpose, so the analytics is
correct either way. But the call purpose is also used elsewhere
(`reasoningModelPolicy.ts`), so don't remove it.

### Step 4 — Run the full integration suite

```bash
cd backend
npx tsc --noEmit
npx vitest run
```

Existing tests must continue to pass without modification. If any
test breaks, it's because the test was tightly coupled to the
non-scoped behavior; document the breakage and fix the test (not the
production code).

## Out-of-scope findings file

If Step 2 surfaces a missing `callPurpose`, log it in
`docs/audit/cost-sidecar-rollout-findings.md` (create the file if it
doesn't exist) so that operators tracking the rollout know the small
adjacent fix landed in the same PR. Per Cursor rule 22.
