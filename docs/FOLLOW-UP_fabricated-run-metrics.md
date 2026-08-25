# CLOSED — `mapApiRunToVaultRun` no longer fabricates run metrics

Closed by the WO-AH branch. `sourcesRetrieved`, `contradictionsDetected`,
`evidenceTier` and `mode` are optional on the UI run type now, the mapper
carries only what the API row says, and `RecentRuns` renders a corroboration
tier only when there is one. `frontend/src/__tests__/components/RecentRuns.test.tsx`
asserts a queued run gets no badge, and is mutation-verified.

The original finding is kept below because the root cause is worth
remembering: a type that could not say "unknown" forced every caller to
invent a value.

---

Surfaced by: WO-AF (run workspace), PR #227. Filed under Rule 22 — a discovery
outside the current work order's scope is either fixed now or tracked, never
dismissed.

## The finding

`frontend/src/lib/researchone/runMappers.ts` maps an API run row to the UI's
run type and hardcodes three fields regardless of what the run actually did:

```ts
sourcesRetrieved: 0,
contradictionsDetected: 0,
evidenceTier: 'supported' as EvidenceTier,
```

`evidenceTier` is not inert. `LiveRunPanel` rendered it as
**"Source corroboration tier: SUPPORTED"**, and that was observed in production
on run `f1e74c06-53d3-44a6-b095-d15fb703dd99` — status **queued**, progress
**0%**, zero sources retrieved, zero claims. The page asserted a corroboration
tier for a run that had not yet started.

This is a confident claim about evidence quality that no evidence produced,
on the product whose stated purpose is verification. It is a correctness
problem, not a cosmetic one.

## What WO-AF changed

Only the run workspace. `LiveRunPanel` now reads the API row directly and shows
only facts the row carries; a regression test asserts a queued run renders no
corroboration tier at all.

The mapper itself is unchanged, because its other callers are outside WO-AF.

## What is still exposed

Grep for the remaining consumers before starting:

```
frontend/src/components/r1-dashboard/RecentRuns.tsx   # imports evidenceTierMeta
```

`RecentRuns` maps rows through `mapApiRunToVaultRun` and imports
`evidenceTierMeta`, so it is the first place to check for the same fabricated
badge. Enumerate every caller by grep rather than from this list — Rule 44 T3.

## The fix, when it is scheduled

Three honest options, in order of preference:

1. **Make the fields optional and absent.** `sourcesRetrieved`,
   `contradictionsDetected` and `evidenceTier` become `| null`, the mapper
   passes through what the row has, and every renderer omits the element when
   the value is null. A missing badge is correct; a fabricated one is not.
2. **Source them.** `dossier_statistics` already carries
   `sources_retrieved_count`, `contradictions_count` and
   `report_evidence_tier_summary`, and `v_dossier` already projects all three.
   A run-level read path could supply real values instead of zeros.
3. **Delete the fields from the UI type** if nothing legitimately needs them.

Option 1 is the smallest change that stops the product asserting something
untrue, and it does not depend on a new read path.

## Rule 44 note

This is T2: a constant standing in for a semantic property. The property is
"how well corroborated is this run's evidence"; the code answers "supported",
always, for every run in every state. The real input that breaks it is any run
at all.
