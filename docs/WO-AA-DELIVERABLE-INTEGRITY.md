# WO-AA — Deliverable integrity and evidence-path repair

**Status:** COMPLETE
**Opened:** 2026-08-12
**Supersedes:** WO-Z Phase 5 (implemented incorrectly — see §2)
**Governing rules:** 42 (deliverable integrity), 37 (intent contracts),
40 (corpus competence gate), 16 (tests must fail without the fix)

---

## 1. Executive statement

WO-Z fixed intent classification. The report from run
`6c59b711-53f1-44f5-b45f-ac39f9eb9a28` correctly resolved to
`opportunity_discovery` and correctly produced a section per requested item.

It was still worthless. Twenty identical placeholder blocks, zero sources,
zero evidence chunks, and a synthesis stage that ran for **0 ms** because it
never executed.

This work order closes the gap between *passing the gates* and *delivering
the artifact*.

Phases 1–4 are **already implemented** on branch
`cursor/low-evidence-synthesis-repair` (see §4). Phases 5–8 remain.

---

## 2. What WO-Z Phase 5 got wrong

WO-Z Phase 5 said:

> proceed to synthesis under an explicit `low_evidence_labeled_delivery`
> mode — deliver the requested artifact with clearly labeled confidence

That was implemented as `buildLowEvidenceLabeledDelivery()`: a pure string
template, no model call, assigned directly to the report and **bypassing
synthesis**. It satisfied `opportunitiesDelivered: 20` while delivering
nothing.

The spec was ambiguous enough to permit it. Rule 42 now states the
requirement without room for interpretation: **degraded modes modify the
synthesis prompt; they never replace the synthesizer.**

Lesson for future work orders: when a phase says "produce X", state
explicitly whether X is model-generated or code-generated, and add the
anti-pattern to the exit gate.

---

## 3. Proven root causes (run `6c59b711`)

| ID | Cause | Evidence |
| --- | --- | --- |
| RC-8 | Discovery planner call failed; catch set `discovery_queries: []`; orchestrator early-returned. **Zero web searches ran.** | Trace: `queries_generating` → 36.3 s → `discovery_ingest_ready` with zero ingested. No `discovery_round_1_complete`. No `planner` role in model usage. |
| RC-9 | `assessEvidenceSufficiency` required `citableChunkCount > 0`; Rule 40 seals the corpus by design, so this was permanently false. **Every run forced into degraded delivery.** | Gate source; corpus gate status `sealed`. |
| RC-10 | `buildLowEvidenceLabeledDelivery` emitted deterministic stubs and bypassed synthesis. | Report body: 20 identical blocks. Phase timings: `synthesis 0ms`. |
| RC-11 | Hardcoded reader-facing strings applied to every intent. | `"synthesizes evidence from 0 sources and 0 evidence chunks"`, `"does not surface explicit contradiction pairs"`. |
| RC-12 | Internal agent ids leaked into the report. | `"What remains unknown: market_scout: zero relevant opportunities extracted"`. |
| RC-13 | Prompt echo still prepended to the report body; ~95 k prompt tokens per specialist call; **1,282,705 tokens total** for a run that produced nothing. | Report lines 4–710 are the raw prompt. Model-usage table. |
| RC-14 | `Objective` still records `GENERAL_EPISTEMIC_RESEARCH` for an `opportunity_discovery` run. | Trace line 8. |

---

## 4. Completed phases (branch `cursor/low-evidence-synthesis-repair`)

| Phase | Change | Verification |
| --- | --- | --- |
| 1 | `assessEvidenceSufficiency` accepts `discoverySourceCount` and `corpusIntentionallySealed`. Sufficiency no longer requires corpus chunks; specialist signals **or** live discovery sources each suffice. Corpus chunks alone with zero extracted signals still earn one re-discovery pass. | `lowEvidenceSynthesisRepair.test.ts`, `evidenceSufficiencyGate.test.ts` |
| 2 | `buildLowEvidenceLabeledDelivery` **deleted**. Replaced with `buildLowEvidenceSynthesisDirective`, a prompt fragment threaded through `generateIterativeReport({ lowEvidenceDirective })` into the section drafter. Synthesis always runs for non-adjudicative intents. Adjudicative exhaustion now throws instead of emitting a placeholder verdict. | Directive tests assert no markdown headings, no `## Opportunity N`, and presence of "all N requested items" |
| 3 | New `deterministicDiscoveryQueries.ts`. When the planner returns no queries, queries are derived from the confirmed plan's `retrieval_queries`, then the topic heading, then salient terms. Logged, persisted as a `deterministic_fallback` discovery event. | 4 tests incl. "never emits an unusable query built from the entire prompt" |
| 4 | Reader-facing fallback summary/conclusion gated on `ADJUDICATIVE_SECTION_INTENTS`. Gap strings rewritten for readers; agent ids and `competence gate` no longer leak. | Test asserts absence of `market_scout`, `competitor_mapper`, `competence gate` |

**Verified:** `tsc --noEmit` exit 0; `eslint src` exit 0; **963 tests pass,
0 failures** (`NODE_ENV=test`).

---

## 5. Remaining phases

### Phase 5 — Prompt echo and token bloat (RC-13)

The raw user prompt is prepended to the report body and is being re-sent to
every agent, producing ~95 k prompt tokens per specialist call and 1.28 M
tokens for a run that delivered nothing.

1. Remove the prompt echo from the report body. It belongs in run metadata
   and the dossier Request tab, both of which already exist.
2. Audit what each specialist actually receives. Pass the **confirmed brief
   and plan**, not the raw prompt, plus only the evidence slice the agent
   needs.
3. Add a per-call prompt-size guard that logs at `warn` above a configured
   threshold, so a regression is visible in telemetry rather than in the bill.

**Exit gate:** report body contains no verbatim prompt; a fixture run of the
reference prompt shows specialist prompt tokens below an asserted ceiling;
test fails without the fix.

### Phase 6 — Objective resolution (RC-14)

`resolveObjectiveFromIntent` exists but the run still records
`GENERAL_EPISTEMIC_RESEARCH` for `opportunity_discovery`. Trace where the
objective is persisted and ensure the intent-derived value wins.

**Exit gate:** a run with `opportunity_discovery` records a non-generic
objective; test asserts the mapping end to end.

### Phase 7 — Evidence burden by claim class (Rule 37 R-L)

Encode the distinction that keeps producing bad output: naming a market
vertical and reasoning about its economics is **domain knowledge** and needs
no citation; asserting a specific price, named program, or statistic is a
**specific factual claim** and needs a source or an explicit
`(unverified estimate)` marker.

1. Extend the section-drafter and verifier prompts with the two-tier burden.
2. Update non-adjudicative rubrics so missing citations on analysis do not
   fail the report, while unmarked specific claims do.

**Exit gate:** a fixture opportunity report with cited analysis and marked
estimates passes verification; the same report with unmarked invented prices
fails.

### Phase 8 — End-to-end regression fixture

Wire the reference prompt into an integration test that runs the pipeline
with stubbed providers and asserts:

- intent `opportunity_discovery`, secondary `feasibility`;
- 20 opportunities, each with a distinct title and non-placeholder body;
- synthesis stage executed (duration > 0);
- no `established_fact` / `contradiction` / `falsification` vocabulary;
- no internal agent ids in the body;
- no verbatim prompt echo.

**Exit gate:** the fixture fails against `main` and passes on the branch.

---

## 6. Global acceptance criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm run test` pass in `backend/`.
- [ ] Rule 37 and Rule 42 pre-commit checklists walked and honestly ticked.
- [ ] PolicyOne snapshot tests still prove adjudicative prompts unchanged.
- [ ] No code path builds a user-facing deliverable from a string template.
- [ ] No degraded path skips synthesis for a non-adjudicative intent.
- [ ] Out-of-scope findings logged in §8.

---

## 7. Progress log

| Phase | Status | Commit | Date | Notes |
| --- | --- | --- | --- | --- |
| 1 — Evidence sufficiency | DONE | | 2026-08-12 | Sealed corpus no longer forces degraded delivery |
| 2 — Synthesis modifier | DONE | | 2026-08-12 | Stub generator deleted |
| 3 — Discovery fallback | DONE | | 2026-08-12 | Discovery can no longer be silently zeroed |
| 4 — Boilerplate gating | DONE | | 2026-08-12 | Reader-facing strings intent-gated |
| 5 — Prompt echo / token bloat | DONE | | 2026-08-13 | Export re-embedded the prompt; specialists received it 3x |
| 6 — Objective resolution | DONE | | 2026-08-13 | Route placeholder now yields to intent-derived objective |
| 7 — Evidence burden by claim class | DONE | | 2026-08-13 | CLAIM_CLASS_EVIDENCE_BURDEN, non-adjudicative only |
| 8 — E2E regression fixture | DONE | | 2026-08-13 | woAaDeliverableIntegrity.test.ts, 14 tests |

---

## 8. Findings log (Rule 22)

| # | Finding | Disposition |
| --- | --- | --- |
| F-1 | `scripts/git/prepare-work-branch.sh` rejects a worktree containing only *untracked* files as "dirty". | Open — consider `--untracked-files=no` in the dirty check. |
| F-2 | `NODE_ENV=production` is set globally on the primary dev machine, so `npm install` silently omits devDependencies and 45 test files fail with "Missing required env file for production". | Open — document in AGENTS.md dev setup; consider a `.npmrc` or preflight check. |
| F-3 | `appHealthPublic.test.ts` `beforeAll` times out when Postgres/Redis are not running, rather than skipping. | Open — make infra-dependent suites skip cleanly when services are absent. |
| F-4 | The discovery planner receives the entire raw user prompt. For long structured prompts this is a likely cause of the RC-8 planner failure, not just a cost problem. | Scheduled — Phase 5. |
