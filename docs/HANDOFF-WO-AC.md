# HANDOFF — finish WO-AC and merge PR #205

**Status:** OPEN — this is your task list
**Created:** 2026-08-13
**Branch:** `cursor/wo-ac-outline-and-repair`
**PR:** [#205](https://github.com/GooseyPrime/ResearchOne/pull/205)
**Last commit:** `9761216`

Read [`.cursor/rules/42-deliverable-integrity.mdc`](../.cursor/rules/42-deliverable-integrity.mdc)
and [`.cursor/rules/37-intent-driven-report-contracts.mdc`](../.cursor/rules/37-intent-driven-report-contracts.mdc)
before touching anything. Rule 41 applies: fix what you find, do not defer it.

---

## Current state — start here

The branch is **green and pushed**. Do not re-verify from scratch; confirm and move on.

```text
backend:  tsc --noEmit  -> exit 0
backend:  eslint src    -> exit 0
backend:  128/128 test files, 1035 tests passing
frontend: tsc --noEmit  -> exit 0
frontend: eslint        -> 11 warnings, ALL pre-existing, none in touched files
```

PR #205 has had two review rounds. **9 of 10 findings are resolved and pushed.**
One remains, described in Task 1.

### What WO-AC already delivers (do not redo)

| ID | Change | Where |
| --- | --- | --- |
| R1 | Contract-driven outline expansion — one drafting section per requested item | `contractOutline.ts` |
| R2 | Word budget scales with contract; explicit user target always wins | `contractOutline.ts` |
| R3 | Targeted repair — append missing sections instead of rewriting the report | `targetedRepair.ts` |
| R4 | Delivered-item counter uses the shared table parser | `researchOrchestrator.ts` |
| R5 | Table formatting rules, scoped to sections that need them | `reportGenerator.ts` |
| R6 | Run summary shows Intent + Model profile — **wired but non-functional, see Task 1** | `RunSummaryReport.tsx` |

---

## Task 1 — Make R6 actually work (Codex finding, unresolved)

**This is the only outstanding review finding. PR #205 should not merge until it
is fixed or explicitly descoped.**

### The problem

`frontend/src/components/research/RunSummaryReport.tsx` now tries to display:

```text
Intent       : opportunity_discovery (secondary: feasibility)
Model profile: NOVEL_APPLICATION_DISCOVERY
```

It reads the intent from `run.confirmed_plan_payload?.researchBrief?.primaryIntent`
with a fallback to `run.intent`.

**Neither field exists.** Codex is correct: `research_runs` has no
`confirmed_plan_payload` column and no `intent` column. The confirmed payload
lives in `research_plans.plan_payload`. The frontend `ResearchRun` type exposes
neither. So `primaryIntent` is always `''`, the `Intent` line never renders, and
the summary still shows only the model profile — the exact confusion R6 exists
to remove.

### Why it matters

A user seeing only `Objective: NOVEL_APPLICATION_DISCOVERY` reasonably concludes
the system reinterpreted their request. It did not — intent and objective are
different axes (report type vs model-ensemble routing profile) — but the UI made
a correct run look broken. This was raised by the product owner directly.

### What to do

Pick whichever is cleaner in this codebase; both are acceptable:

**Option A — expose it on the run API.** Add `intent` / `secondary_intent` to the
run read path, sourced from the confirmed plan. Prefer the existing canonical
read path (`v_dossier` / `dossierReadService`, Rule 32-dossier) over a new query.

**Option B — read from plan data the page already has.** `ReportDetailPage` and
the dossier surfaces already fetch plan/artifact data. Pass the intent down as a
prop rather than having `RunSummaryReport` reach for a field that isn't there.

### Acceptance criteria

- [ ] `Intent` renders on live, completed, **and** failed run-summary surfaces.
- [ ] Secondary intent shown when present: `opportunity_discovery (secondary: feasibility)`.
- [ ] `Model profile` still renders separately, below `Intent`.
- [ ] A test asserts `Intent` appears for a run whose plan declares
      `opportunity_discovery` — and **fails** if the field is unavailable
      (Rule 16: verify by stashing the source change).
- [ ] No new frontend eslint warnings. Current baseline is exactly 11.

---

## Task 2 — Land PR #205

1. Push Task 1.
2. Wait for **both** `copilot-pull-request-reviewer` and
   `chatgpt-codex-connector` to review the new commit. Codex has been slower —
   roughly 8–12 minutes after push. Do not merge before both have reported.
3. Resolve every finding. Two rounds on this PR each surfaced real bugs; assume
   a third will too.
4. Post a resolution comment mapping each finding to its fix, then squash-merge
   and delete the branch.

**Do not merge with unresolved findings.** On this PR, one Codex finding was a
bug where a fully delivered report would have counted as **zero** items.

---

## Task 3 — Add the fixture rule that would have caught this

Two of the ten findings on #205 existed *only* because a test fixture invented a
field production does not have (`RequestedArtifact.type`). The tests passed and
the behaviour was broken on every real run.

Add to `.cursor/rules/42-deliverable-integrity.mdc` as **R42-11**:

> **Fixtures are built from the real interface, not an approximation of it.**
> A fixture that invents a field, or omits a required one, tests a type that does
> not exist in production. Import the production interface and let the compiler
> enforce the shape; if that is impractical, assert one fixture against a real
> instance. Two PR #205 defects — items labelled `Item N` instead of
> `Opportunity N`, and a delivered report counting as zero — were invisible
> because the fixture declared `type` and production has only `description`.

Add the matching pre-commit check to the same file:

- [ ] Does every new fixture match the production interface it stands in for?

---

## Verification commands

Run from the repo root. Note the environment gotchas below.

```bash
cd backend  && npm run typecheck && npm run lint && npm run test
cd frontend && npm run typecheck && npm run lint
```

### Environment gotchas on this machine (already in AGENTS.md)

- **`NODE_ENV=production` is set globally.** npm silently omits devDependencies
  — `npm install` reports "up to date" while `node_modules/typescript` does not
  exist, and 45 test files fail with "Missing required env file for production".
  Install and test with `NODE_ENV=development` / `NODE_ENV=test`.
- **Windows lifecycle scripts fail** with `ERR_INVALID_ARG_TYPE`
  (`msgpackr-extract`, `@clerk/shared`). `npm install --ignore-scripts` is
  sufficient for typecheck/lint/test.
- **Frontend eslint baseline is 11 warnings**, in `AddOnsPage`, `BillingPage`,
  `UnifiedResearchConsole`, `DossiersTimelineTable`, `BugNoteProvider`,
  `ResearchOutputControls`. Do not add to it.

---

## Context: what this work order is fixing

Reference incident is run `e5aac059`. It delivered **8 of 20** opportunities with
no per-item detail and no winner blueprint, then spent **39% of a 36-minute run**
failing to repair itself.

Root cause: section plans are per-**intent**; deliverable contracts are
per-**request**. `intent_opportunity_discovery` declares five fixed sections. The
request needed 20 items × 5 subsections plus a seven-part blueprint — roughly
**107 blocks**. The outline could not hold the contract, so the drafter wrote
what fit and stopped.

Prior work orders, all merged: **WO-Z** (#200 — report-type fidelity),
**WO-AA** (#202, #203 — deliverable integrity, prompt budgets, evidence burden),
**WO-AB** (#204 — trace flood, table rendering and export).

---

## After WO-AC merges — recommended next work

Not part of this handoff. Listed so the next session has context; confirm
priorities with the product owner before starting.

1. **Per-specialist scoped retrieval.** `retrieveChunksWithAudit` is called in
   exactly four places, all in `researchOrchestrator`. Every specialist receives
   the same undifferentiated 50k-char blob. `competitor_mapper` and
   `demand_signal_analyst` read identical text and are asked different questions
   of it — a likely reason specialists keep returning zero extractions. Highest
   quality-per-effort item remaining.
2. **Tier-governed concurrency.** The request page is **not** locked during an
   active run; nothing prevents multiple submissions today. Product owner chose
   queue-only for now and deferred paid concurrency tiers. Add
   `maxConcurrentRuns` to `tierRules.ts` and use a BullMQ per-user limiter rather
   than hand-rolling it.
3. **Parallel section drafting.** With R1 expansion a run can make ~40 sequential
   drafter calls. Most sections are independent for non-adjudicative intents;
   draft in parallel, then one coherence pass.
4. **Discovery ingest barrier tuning.** Run `e5aac059` logged
   `barrier timed out; 2 sources not yet queryable` after waiting 2m47s.
   Correct behaviour, but it is a meaningful slice of total runtime.
5. **Report/run status disagreement.** A report card showed green "complete"
   while the run summary and request page showed failed. The trace says
   `Status: FAILED / contract_failed`, so the green badge is a display bug.
6. **Residual synthesizer vocabulary.** The Executive Summary still says
   "evidence-based methodology". That is model output, not a hardcoded string —
   add an explicit vocabulary line to the drafter directive.
