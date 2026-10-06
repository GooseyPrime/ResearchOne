# ResearchOne upgrade: instructions for the coding agent

Version: 4 Oct 2026, revision 7. Supersedes every earlier copy of this document. Use this document only.

**This file is the working copy.** It lives in the repository at `docs/UPGRADE_PLAN.md`. Whoever completes a slice, records a decision from Brandon, or finds a fact in section 5 that is no longer true updates this file in the same pull request. Do not keep a private copy and do not work from a pasted one.

**What changed in revision 7.** The two live samples for slice 4 part 1 were produced on 4 Oct 2026. The citations worked; the writing did not meet section 2a. Brandon decided the same day that the faults the samples showed are fixed alongside the rest of slice 4, not in a separate detour (grant K in section 7). Part 2 therefore carries those fixes with the reference work. Section 5 gains the facts part 2 established, including one correction: `sources` has had `authors` and `publication` columns since the first migration, so part 2 needed no migration. Slice 4 gains "What the live samples showed" and "As built, part 2".

**What changed in revision 6.** Slice 3 is merged (PR #243). Brandon made three decisions while it was reviewed, recorded as grants H, I and J in section 7: the user's length and format choices are never overridden; when no length is chosen the planner sizes the report to the question; and whether the available material can answer a request is judged by a reasoning model, not counted. Two invariants are added (13 and 14 in section 6). Section 3 gains the review and sample rules. Slice 4 is rewritten at the top to start from what slice 3 built and to carry in what the first scored reports showed. Slice 7 takes the reference-lookup path (issue #244).

**What changed in revision 5.** A report must read like a well-written encyclopedia entry or review article, as good as or better than the strongest deep-research products. Section 2a defines that standard and every slice serves it. Slices 3 to 10 were rewritten around it and section 8 gained reader-quality scores.
Repo: `GooseyPrime/ResearchOne` (public, MIT). Default branch `main`.
Every repository fact below was checked against `main` at `76d5d6f` on 1 Oct 2026, the rows marked (rev 5) against `40dd588`, and the rows marked (rev 6) against the merge of PR #245. If you find one that is no longer true, stop and report it before building on it.

---

## 0. Where things stand

| Phase | Status | Record |
| --- | --- | --- |
| Slice 0. Opening activity | Done | Facts checked; corrections folded into section 5. |
| Slice 1. Clear the desk | Done | PR #237. |
| Slice 2. Measurement harness | Done | PR #239. |
| Fixes outside the slices | Done | PRs #240, #241, #242, #245. |
| Slice 3. Baseline report: writing | Done | PR #243. Behind `BASELINE_LAYER_ENABLED`, unset by default. See "As built" under slice 3. |
| Slice 4, part 1. Citation core | Done | PR #248. Behind `CITATION_LOCK_ENABLED`, unset by default. See "As built, part 1" under slice 4. |
| Slice 4, part 1. Live samples | Done | Produced 4 Oct 2026 with the per-run admin overrides; no switch was turned on for customers. See "What the live samples showed" under slice 4. |
| Slice 4, part 2. Reference details and styles, with the sample fixes | Done | PR #250, with three late review findings closed in a follow-up pull request. Behind the same two switches, unset by default. See "As built, part 2" under slice 4. |
| Slice 4, part 2. Second live samples | Done | Produced 5 Oct 2026. The broad report met the length, shape, numbering and wording points. The single-fact report lost its citations in a repair pass; fixed in the pull request that adds this row. See "What the second samples showed" under slice 4. |
| Slice 4, part 3. DOI and retraction | Built, awaiting review | Link check and retraction rule behind `DOI_RESOLVE_ENABLED`. See "Built in part 3" under slice 4. |
| Slice 4, part 4. Quality judge | Built, in review | The judge now scores a clean report above each of the four spoiled copies. |
| Slices 5 to 10 | Not started | Do not begin any of them until the slice before it is merged and Brandon confirms production healthy (S6). |

Do not redo a completed phase. Their sections below are kept as the record.

**Your task now:** read this whole document again; sections 0, 5, 7 and slice 4 changed. Once part 2 is merged and its deploy is confirmed healthy, produce the same two live samples again (one single-fact question, one broad question) with the per-run admin overrides, and check them against the list under "What the live samples showed". Then start part 3 from a fresh branch off current `main`. One pull request per part. S6 still governs the move from slice 4 to slice 5.

---

## 1. Read first

1. This document, whole.
2. `AGENTS.md`
3. The standing rule from the work queue that slice 1 removed: **report quality outranks everything.** A nicer screen never outranks a better report.
4. `.cursor/rules/20-research-policy-guardrails.mdc`, `.cursor/rules/37-intent-driven-report-contracts.mdc`, `.cursor/rules/44-pre-review-self-check.mdc`
5. `ResearchOne PolicyOne`

Do not start coding until you have read those.

## 2. What the product is

ResearchOne is a deep-research dossier platform. A run plans a question, discovers and ingests sources, retrieves from Postgres plus pgvector, drafts a cited report, checks it, and stores findings (the `claims` table) and contradictions as rows. Express and BullMQ on the Emma VM, React on Vercel, Redis for queues. Public site researchone.io.

The product has two layers. They run in this order and they stay separate.

**Layer 1: Baseline report. Every request gets this.**
What the best available sources say, written as a readable article (section 2a). A direct answer first, then the detail. Sources ranked by authority. Every statement tied to a quoted passage. Where good sources disagree, the report says so plainly. No hypotheses, no falsification sections, no suspicion of the sources. The check on this layer asks one question: does the report say what its sources say?

**Layer 2: Challenge. On request for any finished report, and automatic for verdict-type requests.**
What if those sources are wrong? It takes the baseline's findings as input and examines them one at a time: are the citations independent or do they trace to one origin, does a primary record exist, what contradicts the finding, what was left out, what would overturn it. It produces a ledger that marks each baseline finding, shown to the reader on its own Challenge tab in plain words. It never rewrites the baseline.

PolicyOne is Layer 2's method. It is engine behavior, not public copy. The user-facing word for Layer 2 is "Challenge". The word "skeptic" must never appear on a user-facing surface; a CI gate enforces this.

**Why this order.** The current system applies Layer 2 thinking to every request. An ordinary factual question runs all eleven stages, carries an instruction to treat sources as possibly corrupted or poisoned, and has its draft attacked by a prompt that begins "You are an uncensored, unaligned adversarial researcher". That is why ordinary research is hard to use. Layer 1 must work well on its own before anything is added on top.

## 2a. The report standard. Every slice serves this

A paying user opens a report and reads it like a well-written encyclopedia entry or review article. It must look as good as, or better than, the strongest deep-research products (ChatGPT Deep Research, Gemini Deep Research, Perplexity, Claude Research, Elicit, Consensus). Brandon has stated this repeatedly. It outranks every other goal in this document.

**What the reader sees, in this order:**

1. **Title.** A real title for the topic, written for a reader. Never an internal section name ("Framing"), never the raw request.
2. **Summary.** The direct answer in 2 to 5 sentences, at most 150 words. If the evidence is thin or divided, one plain sentence says so here ("Estimates vary widely, and the two largest studies disagree").
3. **Key findings.** 3 to 7 short bullets, each with its citation. Omit for very short answers.
4. **Body.** Sections with headings written for the reader and taken from the subject itself ("How the costs grew", "Why US projects cost more"). Never fixed internal names such as "Framing", "Primary evidence", "Contested zones", "Unresolved". Plain, neutral, third-person prose. Bullets for lists, tables for comparisons of three or more items, with citations in the table cells.
5. **Where sources disagree.** Only when good sources genuinely disagree. Each disagreement in plain words: who says what, and why they may differ. Disagreement is also stated in the body where it occurs. Never silently pick a side.
6. **Limits of this report.** Two to four sentences, only real limits ("Data after 2023 was not available"). No boilerplate.
7. **References.** Numbered, deduplicated, in order of first citation. Each entry: author or publisher, title, date, link, and source type in words ("government report", "peer-reviewed study", "news article"). Never empty when the report cites anything.
8. **About this report.** At the very end, in small print: what was searched, how many sources were read, the date of the research. Short.

**Citations in the text** are bracketed numbers, `[1]` or `[2, 5]`, matching the reference list. Hovering or tapping a number shows the source title, publisher, date and the exact quoted passage that supports the sentence. The reader never sees `Chunk`, `E#`, a UUID or an internal id.

**Never in the reader's view of a report:**

- Evidence-tier labels or their words used as labels: `established_fact`, `strong_evidence`, `testimony`, `inference`, `speculation`, in any spelling or case.
- Internal step, agent or specialist names (for example `Quantitative_Quality_Auditor`).
- Raw status or enum values (`under_review`, `plan_pending_confirmation`) or snake_case words of any kind.
- Machine boilerplate: "This report synthesizes evidence from N sources and M evidence chunks", a "0 contradictions" box, generic falsification sentences, "denominator integrity", "corpus".
- Courtroom framing in a baseline report: "verdict", "case for", "case against", "falsified", "testimony-tier", "the evidence establishes", "adjudicate". These belong only to the Challenge (Layer 2), and even there in plain words.
- The word "claim" or "claims" for what a report or its sources say. **A report presents information, not claims** (Brandon, 1 Oct 2026). Use "information", "findings" or "what the sources report". This applies to every reader-facing surface: report text, headings, tabs, buttons, counters, exports, notifications, the public sample report, the landing pages and the live progress view. The database table `claims` keeps its name internally and is never shown by that name.
- The same fact or paragraph repeated in more than one section.
- The generation trace, model names or pipeline events. Those live on a separate "How this was researched" tab.

**The "How this was researched" tab is the one exception.** It is a technical record for people who want it. It may name steps and models, written as readable words ("Quality check of figures", not `Quantitative_Quality_Auditor`). It still never shows grade labels, raw status values or snake_case ids.

**The Evidence and Sources tabs** show strength and source type in words only. Never a tier number, a grade label or a raw value.

**Evidence strength is an optional view, never the default.** Brandon's decision, 1 Oct 2026: the grades stay in the database (`claims.evidence_tier`, and the authority tier from slice 6) and power an **Evidence** tab on a finished report. That tab lists each finding with its sources, quoted passages, source type and strength in plain words ("several independent peer-reviewed studies", "a single first-hand account"). The report the user opens first never shows grades. Where strength matters to a reader's decision, the prose says so in ordinary words.

**Length.** Honor the requested length. A short question gets a short answer. Never pad to reach a floor. A typical full report is 1,500 to 5,000 words.

**Exports.** PDF, Word and Markdown exports look like the reader view: same title, summary, numbered citations and reference list. They contain nothing the reader view forbids.

**Already done (PR #242, 1 Oct 2026):**

- The intent templates and the writer, checker and refiner prompts in both prompt sets no longer ask for tier tags or an evidence-tier ledger.
- Ordinary report types and their prompts say "statements" and "information", not "claims".
- `stripInternalLabelsFromReport` in `formatting/reportPresentation.ts` removes tier labels and bracketed step names, leaving code and link text alone. It runs when a report is saved, read, or exported in any format, and also covers the plain-language version, the summary cards and the stored summary and conclusion (`cleanReaderMetadata`).

This is a safety net, not the fix. Slices 3 to 5 make the writer produce the standard in the first place.

## 3. How to work

- Never commit to `main`. Branch with `bash scripts/git/prepare-work-branch.sh <topic-slug>`.
- Before pushing to any branch, check that branch's pull-request state. Never push to a branch whose PR is closed or merged. Open a fresh branch and PR instead.
- Draft PRs only. Brandon merges. No auto-merge.
- Every CI check must be green before you ask Brandon to look. GitHub Actions is working: all checks ran and passed on PR #236 on 10 Sep 2026. If Actions stops running, stop and tell Brandon. Do not substitute a local run for a red or missing check.
- Also paste the full local gate output into the PR description:

  ```bash
  (cd backend  && npm run typecheck && npm run lint && npm test)
  (cd frontend && npm run typecheck && npm run lint && npm test)
  bash scripts/ci/assert-tier-a-no-banned-jargon.sh
  ```

- After pushing, confirm the commit landed on the remote branch and say so.
- Every fix needs a test that fails without it. Run the mutation: revert the fix, watch the named test fail, restore it. Name the test in the commit message.
- Test the pipeline, not the helper. The repeated failure on this repo is a fix that computes the right answer and hands it to something that ignores it. Each acceptance test below must exercise the path a real run takes.
- Work the Rule 44 self-check before requesting review. Reply to every automated review comment before asking for a merge.
- One PR per slice below. Do not combine slices. A slice may be delivered in parts when this document lists the parts (slice 4 is); each part is its own PR, reviewed and merged before the next starts.
- TypeScript strict. No `any` to get past the compiler.
- Where a model call is added, give it a primary and a fallback on a different provider.
- Status updates to Brandon are in plain English: what the system does today, what the change makes it do, what that means for users. No function names or file paths in status updates. Those belong in commits and PR descriptions.
- Nothing that describes internal business state, project status, live defects, machines, or where credentials are kept goes into the repository. The repo is public.
- Do not touch cost-accounting code or the monthly quota constant. Both are parked decisions.
- **Reviews before merge (rev 6).** A slice PR is merged only after the Codex and Copilot reviews have run on its final commit and every finding is fixed, or answered with a reason and resolved. A finding that is real but belongs to another slice is recorded as an issue and named in this document.
- **Live samples (rev 6).** If your environment cannot make live model calls, say so in the first line of your report. Output from a stub or a stand-in model is not a sample of report quality and must not be presented as one.
- **Report the checks truthfully (rev 6).** Never report a PR with any check failing or still running. Name each check and its result.
- **Keep this document current (rev 6).** The PR that completes a slice updates section 0, the slice's heading and its "As built" record, and any section 5 fact it changed.
- Do not send email. Do not add worker-farm roles. Do not invoke a Copilot coding agent to write code.

## 4. Production safety. Read twice

**Merging to `main` deploys the backend to production automatically.** The deploy workflow fires on any push to `main` that touches `backend/**` or `scripts/**`, and migrations run with it. There is no staging environment. Treat every merge as a production release to paying users.

The upgrade is built so that nothing changes for any user until Brandon turns a switch on, and every switch turns back off.

- **S1. Flag off means identical.** Every slice from 3 onward ships a parity test: with that slice's flag off, a fixture run sends the same model messages, calls the same providers and writes the same rows as before the slice. New code is unreachable with the flag off.
- **S2. Flags default off.** Read them through `config/index.ts`. Unset is off. An unrecognized value is off.
- **S3. Migrations cannot hurt a running system.** Additive only. Nullable columns, no defaults that rewrite a table, `IF NOT EXISTS` everywhere, no renames, no drops, no backfills, no recreating a view. The code on `main` before your PR must run correctly against the schema after your migration. The whole migration chain must be applied to a clean Postgres 16 with pgvector, then the migrator run a second time doing nothing. CI does not do this today and the agent sandbox has no Docker, so slice 2 adds a CI job that does exactly this on every PR (see slice 2). From slice 2 on, that job being green is the proof. If you can also install Postgres 16 and pgvector natively in your sandbox, do it and paste the output; if not, say so.
- **S4. You never touch production.** You do not change production environment variables, turn on a flag in production, run anything against the production database, trigger the deploy workflow, or merge. Brandon does all of those.
- **S5. A failure in new code stays contained.** Enrichment code (authority tiers, DOI lookups, provider routing, the tree) catches its own failure, logs it with the run id, and falls back to the pre-slice path. Enforcement code (citation lock, verifier checks) fails the section or run through the existing gate statuses with a plain reason. Nothing new may crash a worker, hang a queue, or affect another run. No silent failures: every fallback is logged.
- **S6. One slice in flight.** Do not start slice N+1 until Brandon has merged slice N and told you production is healthy.
- **S7. Existing tests are a tripwire.** You may change only the existing tests this document names (`challengePassUniform.test.ts`, the routing-gap assertion in `intentFidelityMatrix.test.ts`, the golden suite's variant dimension, the two label cases in `supabaseOpsJobs.test.ts` in slice 2, `researchEnsemblePresets.test.ts` only in a grant B model change, the tests grant G names, and the tests grant K names). If any other existing test fails, your change is wrong. Stop and report. Do not edit the test.
- **S8. Stay inside the slice.** No refactors, renames, dependency upgrades or formatting sweeps outside what the slice needs.
- **S9. Every PR description carries three things:** what a user will notice with the flag on, how to turn it off, and what you could not test.

**Slice 0, the opening activity. Done 1 Oct 2026; do not repeat it. Kept as the record.**

1. On an untouched checkout of `main`, run the three gate commands in section 3. If they are not green, stop and report. Do not fix it as part of this work.
2. Check every row of the facts table below against the code. Report any that is no longer true.
3. Confirm whether you can run Postgres 16 with pgvector and Redis locally and apply all migrations. Done 1 Oct: the sandbox cannot run Docker. This does not block slice 1. Slice 2 closes the gap with a CI job.
4. Change the repository's public description (the one-line "About" text on GitHub, not a file) to exactly:
   `Deep research platform that builds cited reports from trusted sources, then challenges those sources on request.`
   Use `gh repo edit GooseyPrime/ResearchOne --description "..."` or the GitHub API. Leave the homepage URL, topics and visibility as they are. Read the description back afterwards and confirm it matches. If you lack permission, say so and move on; do not try another route. Brandon has approved this wording.
5. Tell Brandon in plain English that the starting point is clean, or what is not, and that the description is changed.

**Turning a slice on is Brandon's sequence, not yours:** merge with the flag off, confirm production healthy, run the harness with the flag on for harness runs only (slice 2 provides this), review the scores, turn the flag on, ask three real questions, watch. Any doubt, flag off.

## 5. Verified facts about `main`

Use these. They correct errors in the earlier spec.

| Topic | Fact |
| --- | --- |
| Migrations (rev 5) | Highest is `058_eval_results.sql`. New migrations start at `059`. Numbers `044` to `047` are taken. |
| Intent ids | `factual_report`, `survey`, `adjudication`, `investigation`, `story_verification`, `opportunity_discovery`, `feasibility`, `implementation`, `literature_review`, `comparative`, `how_to`, `recommendation`, `exploratory`, `position_brief`, `timeline`, `reference_lookup`, `legacy`. Names such as `adjudicative`, `causal_test`, `factual`, `comparison`, `explain` are not intent ids. |
| Methodology | `resolveMethodologyFromIntent` in `planning/researchBrief.ts` returns `policyone` for `adjudication`, `investigation`, `story_verification` only. Everything else, including `position_brief`, is `standard`. Leave that as it is. |
| Pipeline | One engine. Eleven stages in `planning/orchestrationProfiles.ts`. The stage is named `challenge`. Every profile must run it; a type and a runtime guard enforce that. Every profile except `reference_lookup` runs all eleven stages. `reference_lookup` skips `discovery`, `reasoning`, `synthesis`, `plain_language` and `epistemic_persistence` (so it saves no findings); it still runs `challenge`. |
| Preambles | `constants/prompts.ts` holds `REASONING_FIRST_PREAMBLE`, `STANDARD_RESEARCH_PREAMBLE`, `RESEARCH_INTEGRITY_KNOWLEDGE_BASE_BLOCK`. `withPreamble` and `withStandardPreamble` both append the knowledge-base block. `getSystemPrompt(role, isAdjudicative)` in `openrouter/openrouterService.ts` picks between them. |
| Adversarial prefix | `RED_TEAM_V2_SYSTEM_PREFIX` no longer exists. It is `CHALLENGE_PASS_SYSTEM_PREFIX` in `reasoning/reasoningModelPolicy.ts`, applied by `applySystemAugmentations` in `openrouterService.ts` to every run. Rule 20 still uses the old name and the old file. |
| Models | The one engine resolves every role from `V2_MODE_PRESETS` in `config/researchEnsemblePresets.ts`, and those presets are open-weights only: Qwen3-235B Thinking writes, Kimi K2 plans, DeepSeek V3.2 verifies, audits contracts and checks citations, Hermes runs the challenge pass. `V2_FORBIDDEN_DEFAULT_MODELS` in `researchEnsemblePresets.test.ts` rejects closed-provider slugs in those presets. The closed-provider line-ups in `config/defaultModels.ts` and `ENSEMBLE_PRESETS` are not what the engine runs. Rule 20 (as of PR #237) states this and permits a Layer 1 change only through a flagged slice. |
| Discovery | Providers in `discovery/providers/`: Tavily, Brave, generic web, Parallel, arXiv, OpenAlex, Crossref, PubMed Central, Scite, ClinicalTrials, USPTO, URL fetch. `SPECIALIST_CONNECTOR_KEYS` in `discoveryOrchestrator.ts` ties providers to specialist agents, not to the request. `candidateRelevance.ts` filters off-topic results before ingest. |
| Budgets | `discovery/sourceBudget.ts`: floor from config, scales with the deliverable, hard ceiling 40. Config defaults: 10 sources, 5 queries. |
| Citations | `report_citations` has `chunk_quote` and `discovery_origin`. Sources record `discovered_by_run_id`, the discovery query and a rank. `reasoning/citationMapper.ts` binds them. `formatting/evidenceAliaser.ts`, `pandocRunner.ts`, `cslConverter.ts`, `exportOrchestrator.ts` exist. |
| Claims | `claims` rows carry `evidence_tier` (`established_fact`, `strong_evidence`, `testimony`, `inference`, `speculation`). `contradictions` rows exist. |
| Source labels | `planning/sourceClassTypes.ts` has a discourse label (`consensus_held`, `actively_contested`, and so on). There is no source authority ranking anywhere. |
| Numbers | `reasoning/deterministicQuant.ts` already parses and checks numeric values. |
| Tests | `planning/goldenPromptSuite.ts` (17 intents, each in a `standard` and a `deep` variant that no longer mean anything), `planning/goldenPromptEvaluation.ts`, `__tests__/intentFidelityMatrix.test.ts`, `__tests__/challengePassUniform.test.ts`, `__tests__/orchestrationProfilesChallengeFloor.test.ts`. No `eval/` directory exists. |
| Routing gap | `factual_report` and `reference_lookup` have no deterministic route. A bare "what is X" depends on a model call. The fidelity matrix asserts this gap on purpose. |
| Already built | Clerk auth, Stripe, wallet holds, BYOK, Pandoc export. Do not rebuild any of them. |
| Citation markers (rev 5) | The writer cites passages as `[... Chunk N]`, numbered by position in the chunk list it was given. `citationMapper.ts` binds sections to chunks with a model call. On the 1 Oct pilot the binding produced nothing, so the reading page showed "No mapped citations available" under a cited report. |
| Report front matter (rev 5) | `researchOrchestrator.ts` writes reader front matter itself: "This report synthesizes evidence from N sources and M evidence chunks…", a contradiction-count sentence, and a generic falsification sentence built from the request. |
| Reading page (rev 5) | `frontend/src/pages/ReportDetailPage.tsx` renders the report with machine panels: contradictions, counterevidence and falsification, evidence coverage, report status (raw `under_review`), run reference, falsification criteria, and the generation trace. |
| Label safety net (rev 5) | PR #242 removed every tier-tag requirement from `intentOutputTemplates.ts` and from the synthesizer, verifier and coherence-refiner prompts in `openrouterService.ts`. It added `stripInternalLabelsFromReport` in `formatting/reportPresentation.ts` (re-exported from `reportGenerator.ts`), applied at save, on read, and in the Markdown and Pandoc export paths. Ordinary report templates and the standard prompts no longer use the word "claims"; the three challenge templates still do until slice 3 rewords them. |
| Layer 1 opt-in (rev 6) | Layer 1 prompt handling applies only when the caller passes `baselineLayer: true`, the switch is on and the run is not adjudicative (`resolveBaselineLayer` in `openrouterService.ts`). It is never inferred from a missing `isAdjudicative`. Only the report writer in `reportGenerator.ts` opts in. |
| Baseline helpers (rev 6) | `reasoning/baselineReport.ts` holds the reader section plan, heading acceptance, repetition removal, `renumberCitations`, `buildReferences`, `buildAbout`, `distinctSourceCount`, `isoDay` and the reader scores. |
| Citation markers (rev 6) | With the switch on, the section writer is told that a sentence drawn from `CHUNK n` ends with `[n]`. `renumberCitations` gives each cited source one number, rewrites the markers and removes any marker with no source behind it. Nothing is bound to `report_citations` yet; slice 4 does that. |
| Citation lock (slice 4, part 1) | `reasoning/citationLock.ts` and `reasoning/citationBinding.ts`. With `CITATION_LOCK_ENABLED` and `BASELINE_LAYER_ENABLED` both on and a non-adjudicative run on the iterative path, the section writer is shown whole passages under `[P#]` markers and may cite only those. The markers are numbered, and the reference list and closing note are built, in `researchOrchestrator.ts` after verification and repair and before the plain-language version and the save. One `report_citations` row is written per citation with `section_id`, `chunk_id`, `source_id`, a word-for-word `chunk_quote`, `citation_order` and the reader number in `citation_text`. The model-based citation mapper is skipped for a report saved this way. |
| Report length (rev 6) | `resolveReportWordTarget`: a length the user chose is used as chosen; otherwise the confirmed plan's `outputShape.estimatedLength` sets it; otherwise the standard default, logged. A planner or default length is not a user choice for contract growth (`userChosenWordTarget`). Under 300 words the report is the summary, references and closing note. |
| Material check (rev 6) | `reasoning/materialSufficiency.ts`. With the switch on and a non-adjudicative run, a model judges after retrieval and before reasoning whether the material can answer the request. Insufficient and discovery enabled on the server: one extra search, wait for ingest, re-run retriever analysis and specialists, judge again. Still insufficient: the run ends with a plain reader message, no report row, hold released. Judge unreadable on both models: `assessSourceSufficiency` decides and that is logged. |
| Outside search control (rev 6) | There is no per-request control by which a user turns outside search off. Availability is `config.discovery.enabled`. |
| Request form (rev 6) | The default length is "Automatic (fit the question)" and sends no length. "Standard (~2,200 words)" is a separate choice. |
| Reference lookups (rev 6) | `reference_lookup` uses the light synthesis branch in `researchOrchestrator.ts`, which is not changed by `BASELINE_LAYER_ENABLED` (issue #244, assigned to slice 7). |
| Cost telemetry (rev 6) | The insert into `agent_executions` was rejected by Postgres on every call until PR #245. Prices are read from the `model_pricing` table; a model with no row is recorded at zero cost with a warning. |
| Eval harness (rev 6) | `--score-run <run id>` scores a stored report without signing in and writes only to `eval_results`. `report_quality` is judged by one model with a fallback on another provider. |
| Source details (rev 7) | `sources` has had `authors TEXT[]`, `publication TEXT` and `published_at` since migration `001`. Nothing filled `authors` or `publication` before slice 4 part 2. Retrieval already reads `publication` as the publisher. The highest migration is still `058`. |
| Reference list (slice 4, part 2) | `formatting/referenceList.ts` writes every reference entry: author or publisher, title, date, kind of source in words, link, and for a web page the day it was read. A detail that is not known is left out. `resolveReferenceStyle` turns `research_runs.citation_style` into a style; none chosen means the numbered default. The numbers in the text are the same in every style. |
| Reference details at ingest (slice 4, part 2) | Crossref, OpenAlex, arXiv and PubMed Central results carry `bibliographic` (authors, publisher, what the record says the work is, and a date only when the record gives a full day that exists). `candidateForRun` in `discovery/providerTypes.ts` keeps it only when the citation lock is on for the run; the ingestion job then stores it in `sources.authors`, `publication`, `published_at` and under `metadata.bibliographic`. With the lock off a candidate, a queued job and a stored source are what they were. |
| Section size (slice 4, part 2) | With the Layer 1 switch on and no format chosen, `readerSectionBudgets` in `reasoning/baselineReport.ts` sizes the summary (150 words), key findings (180), the disagreement note (220) and the limits (90) by what they are for, and the subject sections share the rest. A section more than 1.35 times its share is asked for once more, then cut at a sentence. `isSizedReaderSection` names the sections this applies to; the steps of a how-to, a comparison table and sections a request named are never cut. |
| Planner length (slice 4, part 2) | A length nobody chose is capped at `PLANNER_WORD_CEILING` (5,000 words). A length the user chose is not. Neither is a request for many items with required fields, which is sized to hold them, as slice 3 decided. |
| Plan revision (rev 7) | `POST /api/runs/:runId/plan/refine` runs inside the switches recorded for the run (`eval/runFlagStore.ts`). `alignBriefWithIntent` in `planning/planJson.ts` makes the brief follow a report type changed at the plan screen: the method follows the type unless the user asked for the challenge method by name. This part applies with every switch off. |
| Request form (rev 7) | The citation style control on the request form and on the follow-up (spinoff) form opens on "Report default" and sends no style. A style is sent only when one is chosen. The export dialog opens on the style a report's reference list was saved in (`reports.metadata.reference_style`), else the run's style, else APA as before. |
| Export of a locked report (slice 4, part 2) | `exportOrchestrator.ts` hands Pandoc the saved text of a report written with the citation lock, with its own numbers and reference list and no aliases or second bibliography. Asked for another style, it rewrites only the reference list from `report_citations` joined to `sources` (`formatting/lockedReportExport.ts`). Every other report exports as before. |
| Wording check (rev 7) | `readerFacingLabelHits` also fails "claim" and its forms in the report's own words (not in a direct quotation, a reference entry, or a term of the subject such as a patent or insurance claim), "the evidence establishes", "testimony-tier", and a role of the pipeline named in a sentence. `removeBannedWording` puts each into plain words. `finalizeLockedReportForSave` runs both on the text about to be saved, after verification and repair. |

## 6. Invariants. A PR that breaks one is rejected

1. Do not edit the file `ResearchOne PolicyOne`.
2. Do not edit `REASONING_FIRST_PREAMBLE` or the body of `withPreamble`.
3. Layer 2 behavior stays mandatory for `adjudication`, `investigation`, `story_verification`, and any run with `resolvedMethodology === 'policyone'`.
4. No stage on any layer may sanitize, debunk from model recall, or drop information found in a source. Layer 1 reports what sources say, including when they disagree. Compressors may drop exact duplicates only. The one exception is slice 3 item 8: a sentence that repeats, in the same report, what an earlier section already says may be removed, because the information is kept once.
5. The `challenge` stage runs on every run. What it does differs by layer (section 7, grant C). `orchestrationProfilesChallengeFloor.test.ts` stays green unchanged.
6. Corpus seal stays. Citable evidence comes from partitions that cleared independence and density, or from sources ingested on this run (`discovered_by_run_id` on the source; `discovery_origin` is stamped on the citation). A live search hit is not citable until ingested and chunked.
7. Authority ranking orders and labels sources. It never excludes one. No publisher, quartile or venue bans.
8. Layer 2 never treats missing evidence as proof of suppression. Missing evidence produces an entry with status `open` and a labelled hypothesis. It is never written as a finding.
9. No new default model without the existing live OpenRouter probe passing and the ensemble allowlist test passing.
10. Every new model call has a fallback on a different provider.
11. Budgets are hard. The ceiling in `sourceBudget.ts` and the wallet hold both still abort a run.
12. Nothing on the section 2a never-list reaches a reader, on any surface, except as section 2a allows on the "How this was researched" tab. Every slice from 3 on keeps `presentation_clean` at 1.0 in CI and in the harness.
13. **A switch that is off changes nothing (rev 6).** With a slice's flag unset, a run sends the same prompts, returns the same text and writes the same rows as `main` did before the slice. Each slice keeps a test that asserts this on the real pipeline path.
14. **Layer 1 is an explicit opt-in (rev 6).** A model call gets Layer 1 handling only when its caller asks for it. Challenge roles and adjudicative runs keep the policy block and the challenge prefix whatever the flags say.

## 7. Permissions Brandon has granted

These are explicit. Do not go beyond them.

- **A. The knowledge-base block comes off Layer 1.** You may change `withStandardPreamble` in `constants/prompts.ts` so that it no longer appends `RESEARCH_INTEGRITY_KNOWLEDGE_BASE_BLOCK`, and add one new constant for Layer 1 source handling. Nothing else in that file changes. `withPreamble` keeps the block.
- **B. Layer 1 may use the best model for the job.** Closed-provider models are allowed for Layer 1 writing, checking and judging, always with a fallback on another provider. The low-refusal requirement applies to Layer 2 challenge roles only. Rule 20 already says this (PR #237). Moving a role is its own change: behind a flag, only after the harness shows the candidate scores at least as well on `answer_correct`, `quote_supports` and `citation_bound`, and in one PR that changes the role's preset and the forbidden-defaults test together. Layer 1 runs read the new model; Layer 2 runs and flag-off runs keep the current presets. Bring the harness numbers and the cost difference to Brandon before opening that PR.
- **C. The every-run check differs by layer.** On Layer 1 the `challenge` stage is a source-fidelity check and does not receive `CHALLENGE_PASS_SYSTEM_PREFIX`. On Layer 2 it is the adversarial pass, unchanged. `challengePassUniform.test.ts` asserts the old uniform contract. Rewrite it to assert the new one, and say in the commit that the contract changed by instruction.
- **D. `position_brief` stays `standard`.** Do not make PolicyOne mandatory for it.
- **E. Internal documents leave the repository.** See slice 1.
- **F. Evidence strength is an optional view.** Brandon, 1 Oct 2026: grades (`evidence_tier`, and authority from slice 6) are never shown in the report a user opens first. They power the Evidence tab of a finished report (slice 5), written in plain words.
- **G. Tests that pin what is being replaced.** In slice 3 you may update existing tests that pin the old template section names, the old reader front matter or the old title behaviour. In slice 5 you may update existing tests that pin the old reading-page panels, the sample report, landing-page wording that says "claims" (`universalClaimsGuard.test.tsx`, `wave4VocabularyParity.test.tsx`) and the live progress panel (`LiveRunPanel.test.tsx`). In slice 3 and slice 8 you may update existing tests that pin the old challenge-template wording. In each case, list every changed test in the PR description with one line on why, and say that the contract changed by instruction. No other existing test may change (S7).
- **H. Length and format belong to the user (rev 6).** Brandon, 2 Oct 2026: the user chooses the report length and any formatting standard, and the system does not override either. When the user has not chosen a length, the planning model sizes the report to the question; a single-fact question gets a short direct answer, not a long report.
- **I. Sufficiency is judged, not counted (rev 6).** Brandon, 2 Oct 2026: the orchestrating reasoning model decides whether the available material is of suitable quality and content to answer the request. If it is not, the system searches outside when it is allowed to; if it still is not, the user is told plainly that the supplied information is not enough, and what to do next. A Layer 1 run is not failed, degraded or padded because a source count fell short of a fixed number. A proposal in review to write the report anyway with caveats was declined for Layer 1.
- **K. The sample findings are fixed inside slice 4 (rev 7).** Brandon, 4 Oct 2026: the faults the first live samples showed are fixed alongside the remaining slice 4 work. Part 2 carries them. Two of them were pinned by tests written in part 1 and slice 3, which part 2 updates and lists in its pull request: the doubled reader number and the reference-entry layout in `citationLockPipeline.test.ts`, the reference-entry layout in `baselinePipeline.test.ts`, and the default citation style in the frontend `ResearchRequestForm.test.tsx`. The defect in changing the report type at the plan screen is fixed in the same pull request; it is not gated by a switch, because it is live for every customer.
- **J. This document lives in the repository (rev 6).** Brandon, 2 Oct 2026: this plan is kept in the repository as the working document. It carries slice progress and decisions. It still carries no machine addresses, credentials, run identifiers, spend or other operating detail (section 3).

## 8. Measurement

A change is better only if the harness says so. Record scores on current `main` before changing any behavior. Harness runs use production infrastructure through the admin-only switch built in slice 2, because no staging environment exists.

Task set: 30 tasks, frozen after slice 2.

- 15 factual questions, each with a known answer, a list of key facts that must appear, and a named primary source.
- 8 survey or literature tasks.
- 7 challenge tasks (`adjudication`, `investigation`, `story_verification`), each with a fixture conflict between two sources and a fixture anomaly phrase.

Scores:

| Score | Meaning | Kind | Target |
| --- | --- | --- | --- |
| `answer_correct` | Factual tasks: share of key facts present and not contradicted | deterministic | >= 0.90 |
| `citation_bound` | A report written with the citation lock: every reader number in the prose (`[1]`, `[2]`) is backed, in order, by a `report_citations` row carrying the same number, a passage and a non-empty `chunk_quote`, and no saved row is left over. Any other report: the share of its saved rows that carry a passage and a quote. `[E#]` is the export engine's alias and is not scored. | deterministic | 1.0 |
| `quote_verbatim` | Each `chunk_quote` appears, whitespace-normalized, in the stored chunk text | deterministic | 1.0 |
| `quote_supports` | The cited sentence is supported by its quote | judge model, fixed model and prompt committed | >= 0.90 |
| `authority_share` | Share of citations from the top two authority tiers | deterministic, null until slice 6 | report only |
| `doi_resolution` | Emitted DOIs that resolve | deterministic | 1.0 |
| `contradiction_retention` | Challenge tasks: a `contradictions` row exists for the fixture conflict | deterministic | 1.0 |
| `anomaly_retained` | Challenge tasks: the fixture phrase appears or is quoted | deterministic | 1.0 |
| `time_to_report` | Seconds, p50 and p90 | deterministic | Layer 1 must get faster, never slower |
| `tokens` | From `agent_executions`, p50 | deterministic | <= 1.5x the recorded starting point |

**Reader-quality scores (added 1 Oct 2026; built in slice 3).** They score the report as the reader sees it. Until slice 5 that is the stored report text after the safety net; from slice 5 it is the text the reading page renders. `structure_complete` has two parts: the title, summary and heading checks apply from slice 3; the citation and reference-list checks apply from slice 4.

| Score | Meaning | Kind | Target |
| --- | --- | --- | --- |
| `presentation_clean` | Share of reports with no section 2a never-list item. Two lists, in one config file, with a test per entry. **Everywhere list** (baseline and Challenge): tier words used as labels, snake_case tokens outside code, bracketed internal names, raw status values, the listed boilerplate phrases, "claim" and "claims", "verdict", "testimony" used as a label, "adjudicate". **Baseline-only list:** the rest of the courtroom words ("case for", "case against", "falsified", "the evidence establishes"). The Challenge may say "the strongest argument for" in plain words. | deterministic | 1.0 |
| `structure_complete` | A reader title (not an internal name or the raw request); a summary of at most 150 words first; at least one numbered citation; a non-empty reference list whose numbers match the text; no heading from the internal-name list | deterministic | 1.0 |
| `no_repetition` | No sentence appears, near-identically (normalized 5-gram overlap above 0.8), in two different sections | deterministic | 1.0 |
| `report_quality` | A fixed judge scores the report 1 to 5 on each point of section 2a (answer first, readable structure, plain neutral prose, citation clarity, honest disagreement, appropriate length). Fixed model, fixed prompt, committed, with a fallback on another provider. | judge | mean >= 4.0 |
| `pairwise_vs_reference` | For factual and survey tasks that have a reference report, a fixed judge compares ResearchOne's report with the reference blind, in both orders, on the section 2a rubric. Win or tie counts. | judge | >= 0.5 at slice 5, then rising |

Reference reports are answers to the same task questions from a leading competitor product, saved by Brandon. They are third-party text: **never commit them to the repository.** The harness reads them from a directory given by the environment variable `EVAL_REFERENCE_DIR` on the machine that runs the harness, one Markdown file per task id. A task without a reference file scores `null` for `pairwise_vs_reference`.

`presentation_clean`, `structure_complete` and `no_repetition` also run in CI on every PR against the stored fixture reports, with no network and no model.

Rules:

- Run the harness after every slice. If the slice's target scores do not move, or any score regresses, stop and report. Do not start the next slice.
- A full harness run costs real money. Give Brandon the estimated cost and wait for a yes before the first full run and before any run expected to cost more than the last.
- Report scores to Brandon directly. Do not commit result files to the repository.
- Do not advertise any external benchmark number. Do not describe the product as best in the world.

## 9. Slices

Each slice is one draft PR. Each ships behind its flag, default off. Migrations are additive and nullable. Rollback is turning the flag off. Never drop a table in the same release that stops using it.

### Slice 1. Clear the desk (done)

**Done.** Merged as PR #237 (`76d5d6f`) on 1 Oct 2026. The record below stays for reference; do not redo it.

No behavior change.

- Remove from the repository tree: every work order, brief, handoff, review, update and report file at the root (`WO-*`, `HANDOFF_*`, `CRITICAL RESEARCHONE CORRECTNESS WORK ORDER.md`, `Copilot_*`, `ResearchOne_*`, `ResearchOne System Refinements.txt`, `ResearchOne — Deep Repository Review.docx`, `Research Policy Model Compliance Review - Google Gemini.pdf`, `researchone-user-guidance-ux-copy-implementation-brief.txt`, `onlinbusinessreport.md`, `RESEARCHONE_WORK_QUEUE.md`), and the folders `Wave 4`, `Wave 5`, `Work Order U`, `Work Order V`, `Work Order W`, `Work Order X`, `audit-snapshots`.
- Before deleting, prove nothing depends on them: search source, build scripts, CI workflows and rule files for every path. As of 30 Sep no source, script or workflow reads any of them, but `AGENTS.md`, `README.md`, rule files 20, 22, 37, 38, 39 and 44, and several files under `docs/` cite them by name. Rewrite each citation so nothing points at a removed file, keeping the rule's substance.
- This slice must not touch `backend/**` or `scripts/**`, so merging it does not trigger a production deploy. Rule and instruction files change only to fix citations of removed documents, plus the Rule 20 update below.
- Brandon approved the removal list (19 root files, 87 folder files) and the `docs/` rule below on 1 Oct. Do not ask again file by file. If you find a file the rule does not clearly cover, keep it and name it in the PR description.
- `docs/` holds 96 files. Brandon has approved this rule. **Keep** only: `marketing/tier-a-banned-jargon.txt`, `marketing/tier-a-manifest.txt` (a CI gate reads both), `V2_MODEL_SELECTION_CRITERIA.md`, `INTENT_FIDELITY_SMOKE.md`, `HOW_RESEARCHONE_RESEARCHES.md`, `AGENTS_INTENT_ROUTING.md`, `RETENTION_AND_WORKSPACE_POLICY.md`, `governance.md`, `governance/REDESIGN_AGENT_RULE_APPLICABILITY.md`, `billing/addon-cancellation-behavior.md`, and the three files in `RUNBOOKS/`. **Remove everything else under `docs/`**: all work orders, briefs, handoffs, final reports, site audits, postmortems, reliability and phased plans, `audit/`, `release/`, `retrospectives/`, `roadmap/`, `sovereign/`, `supabase-ops/`, `integrations/`, every other subfolder not named in the keep list, the production deployment checklist, and every wave, scope and workplan note.
- The production deployment checklist carries the production server address, and `docs/supabase-ops/` documents a project that is not ResearchOne. Remove both without exception. `WO-AE_COPILOT_BRIEF.md` at the root goes for the same reason and is already on the removal list.
- Before removing any `docs/` file, confirm no test, script or CI step **reads** it. As of 1 Oct only the two `marketing/` files are read; every other reference is a comment or a message string.
- `.github/copilot-instructions.md` carries a work-order status table and links into `docs/`. Remove the status table and fix the links.
- Do not edit code comments in this slice. Comments in `backend/**` and `frontend/**` that name a removed document stay as they are; list them in the PR description for cleanup in a later slice. Editing them here would trigger a production deploy.
- `frontend/scripts/wave2-audit-snapshots.mjs` writes into `audit-snapshots/`. Leave the script. Add `audit-snapshots/` to `.gitignore` so its output cannot be committed again.
- Keep: `AGENTS.md`, `README.md`, `LICENSE`, `ResearchOne PolicyOne`, `.cursor/rules`, `.github`, `backend`, `frontend`, `infra`, `scripts`, config files.
- Update Rule 20: current constant name and file for the adversarial prefix; the model rule per grant B; remove "V2" framing where it describes a split that no longer exists.
- Do not rewrite git history. Removed files remain in history; tell Brandon that plainly so he can decide separately.

Acceptance: both builds and all tests pass. The PR's changed-file list contains nothing under `backend/`, `frontend/src/` or `scripts/`. A search of the tree for each removed filename returns nothing outside code comments in `backend/` and `frontend/`, and those remaining comments are listed in the PR description.

### Slice 2. Measurement harness (done)

**Done.** Merged as PR #239 (`15beeb2`) on 1 Oct 2026. The record below stays for reference; do not redo it. Two follow-ups for the slice 3 PR, found in the pilot: (1) a run that exceeds the per-run timeout must not stop the other runs from being scored, and the command must be able to score already-finished runs by id without starting new ones; (2) a 401 or 403 from the start route must print the server's reason, because a plan-limit refusal was reported as "sign-in rejected".

No pipeline behavior change.

- **First commit of this slice: remove an unrelated project's details from backend files.** This is the first slice allowed to touch `backend/**`, so it is done here.
  - In the header comments of `backend/src/jobs/supabaseBackupCron.ts`, `supabaseKeepAliveCron.ts` and `supabaseLogExportCron.ts`, the `Example:` line holds a real project reference and a real project label. Replace the reference with `<project-ref>` and the label with `example-project`.
  - In `backend/src/__tests__/supabaseOpsJobs.test.ts`, the first two `sanitizeLabel` cases use that project's name. Change them to `['example-project', 'example-project']` and `['Example Project Name', 'Example-Project-Name']`. This is a fourth existing test you may edit, for this change only.
  - Comments and test sample text only. No logic changes.
  - Then search the whole tree, case-insensitively, for that project's name and its reference string. Nothing may remain outside the `audit-snapshots` image data, which slice 1 already removed. Do not repeat the name or the reference in the commit message, the PR title or the PR description; write "unrelated project references".
- **Second commit: comments that still name removed documents.** PR #237 removed documents that backend and frontend comments still cite. Reword those comments so they no longer point at a removed file, keeping what the comment explains. Known cases: `backend/src/services/telemetry/index.ts` and `costSidecar.ts` (the cost-sidecar design doc, now Rule 25), `backend/src/api/webhooks/bugnote.ts` and `backend/src/config/index.ts` (the BugNote scope doc), `frontend/src/index.css` (the site audit), the comment lines in `backend/.env.example`, `backend/.env.development.example` and `backend/.env.production.example` that cite removed docs, plus the Wave and Work Order labels listed in PR #237's description. Search for every removed path to find the rest. **Never edit a file under `backend/src/db/migrations/`**, including migration `030` and its database COMMENT: existing migrations may already be applied.

- Build on `goldenPromptSuite.ts` and `goldenPromptEvaluation.ts`. Do not create a parallel system. Remove the `standard`/`deep` variant dimension.
- Add the 30-task set and the scorers in section 8 under `eval/` at the repo root, with a runner in `backend/src/services/eval/`.
- Store results in a new table `eval_results` (`run_id` fk to `research_runs`, `task_id`, `scores` jsonb, `git_sha`, `created_at`), migration `058`. Do not add columns to `research_runs` and do not recreate the `v_dossier` view.
- The judge for `quote_supports` uses one fixed model with one fallback on another provider. Commit the prompt.
- **Harness-only switch.** There is no staging environment, so the harness needs a way to run a flagged path without turning it on for users. Add a per-run flag override on the start-research request that is honored only for an admin account (use the existing admin check), is recorded on the run, and is ignored for everyone else. Without it, flags come from config only.
- Deterministic scorers must also run with no network and no model, against stored fixture reports, so they run in CI on every PR.
- **Migration rehearsal in CI.** Add a CI job that starts a Postgres 16 service with pgvector, applies every migration from `001` in filename order with `npm run migrate`, then runs it a second time and fails unless the second run applies nothing. It runs on every PR that touches `backend/src/db/migrations/**`. If the existing chain does not apply cleanly to a fresh database, stop and report; do not edit an existing migration.

Acceptance:

- A fixture report with a dangling `[E9]` scores `citation_bound < 1`.
- A fixture report whose quote is not in the chunk text scores `quote_verbatim < 1`.
- A fixture factual report missing one of four key facts scores `answer_correct = 0.75`.
- A non-admin request carrying a flag override runs exactly as if it carried none. Test through the route, not the helper.
- The three job-file comments and the label test contain only placeholder values, and the label test still passes.
- Starting-point scores for current `main` are reported to Brandon.

### Slice 3. Baseline report: writing (done)

**Done.** Merged as PR #243 on 2 Oct 2026, behind `BASELINE_LAYER_ENABLED` (unset). The instructions below stay as the record; do not redo them.

**As built, where it differs from the text below.**

- Item 10 (length) follows grant H, not a lowered fixed minimum: the user's choice, else the plan's estimate, else the standard default.
- Item 11 (plain questions): a classifier failure falls back to `factual_report` only for a short, plainly factual question. Anything contested or unrecognised keeps the failure path.
- Sufficiency follows grant I: the material check in section 5. The passage-count trigger first built for lookups was removed.
- Citations are an interim scheme (section 5, "Citation markers (rev 6)"). Slice 4 replaces it with bound citations.
- The reference list shows publisher, title and calendar date for cited sources; the closing note states how many distinct sources were read and the date.
- Not yet shown on live output: no report written by live models with the switch on has been reviewed. The first one is produced on the server before the switch is turned on for anyone.

**Carried forward.** The items under "Carried in from slice 3" at the top of slice 4.

**Original instructions (rev 5).**

Flag `BASELINE_LAYER_ENABLED`. This slice makes the writer produce the section 2a report. It is the most important slice in this document.

Scope: the baseline text of every run. For `standard` runs that is the whole report. For `policyone` runs (`adjudication`, `investigation`, `story_verification`), the report now **opens with a baseline article written to section 2a**. The existing adversarial sections follow it at the end, under one heading, "Challenge". Reword the three challenge templates now so that section is plain words, with no "claims", no grade labels and no "verdict" (the everywhere list in section 8). Slice 5 moves that section onto a Challenge tab, and slice 8 replaces its content with the ledger. Invariant 3 still holds: the adversarial pass still runs for those intents.

1. **Preamble.** Apply grant A. The new Layer 1 block says: report what the sources say; when sources conflict, prefer primary and official records and peer-reviewed work, judged from what each source is, and say so (slice 6 makes this systematic); state disagreement between good sources plainly; mark uncertainty in ordinary words; do not speculate about sources' motives; do not add facts from model recall; write as a neutral encyclopedia or review article; present information, not claims.
2. **Fidelity check.** Apply grant C. On Layer 1 the `challenge` stage checks, statement by statement: the quote supports the sentence; nothing is overstated; no material point in the retrieved sources is left out; source disagreements are kept. Its notes go to the record behind the Evidence and "How this was researched" tabs (slice 5). **They are never written into the report text.**
3. **Structure.** Change the intent output templates for every `standard` intent to the section 2a skeleton:
   - title, summary, key findings, body sections with reader headings, "Where sources disagree" only when it applies, limits, references, "About this report".
   - Remove fixed internal section names from what the reader sees. Section keys may stay as internal ids; the heading a reader sees is written for the subject.
   - The survey's established, contested, hypothesized and lore layers become reader headings in words ("What is well established", "Where researchers disagree", "Open questions"). Never the layer names.
   - Keep each intent's purpose. A how-to is still steps; a comparison still has a table.
4. **Answer first.** The summary is at most 150 words and answers the question directly. Change the templates, not the preamble.
5. **Title.** `deriveGeneratedReportTitle` must produce a reader title for the subject. Never an internal section name ("Framing") and never the raw request.
6. **No machine filler.** With the flag on:
   - Remove the generated front matter in `researchOrchestrator.ts` from the report body: the "This report synthesizes evidence from N sources and M evidence chunks…" text, the contradiction-count text and the generic falsification sentence.
   - Source and search counts move into the short "About this report" note at the end.
   - Falsification criteria stay in the run record for the Challenge; they are not printed in the baseline.
7. **The writer never sees grades.** The source context given to the section writer carries no "Evidence Tier" lines and no grade words. Reasoning roles keep them. Assert on the messages actually sent to the writer.
8. **No repetition.** Each section is drafted knowing what earlier sections already said. After drafting, the `no_repetition` check runs. A section that repeats an earlier one is redrafted once; if it still repeats, the repeated sentences are removed and the removal is logged.
9. **Final presentation check.** Before a report is saved, run the `presentation_clean` check (section 8) on it.
   - A section that fails is redrafted once.
   - If it still fails, the safety net from PR #242 removes what it can, the run records the failure with a plain reason, and the harness counts it.
   - Never ship a forbidden item silently.
10. **Length.** Honor the requested length. Lower the minimum for `factual_report` and `how_to` so a short question can get a short report. Never pad to reach a floor.
11. **Plain questions route without a model.** When the classifier is unreachable or unsure, a plain question resolves to `factual_report`.
    - The `reference_lookup` profile skips discovery today, so a lookup on a topic the corpus does not hold has nothing to cite. With the flag on, a lookup that finds nothing in the existing corpus must run discovery and write its answer from what it ingests.
    - Make this a flag-gated runtime decision; do not change the shared profile for flag-off runs.
    - The fidelity matrix asserts the current gap; update it and say so in the commit.
12. **Stages.** Do not remove any stage or specialist. You may propose skipping a stage on specific Layer 1 intents only with harness numbers showing `answer_correct`, `quote_supports` and `report_quality` hold and `time_to_report` improves. Bring the numbers to Brandon first.
13. **Build the reader-quality scorers** in section 8 (`presentation_clean`, `structure_complete`, `no_repetition`, `report_quality`, `pairwise_vs_reference`). The forbidden-word lists live in one config file with a test per entry. The three deterministic scorers run in CI on stored fixture reports.
14. **Harness follow-ups from the pilot** (see slice 2):
    - one run passing its timeout must not stop the others being scored;
    - add `--score-run <id>` (repeatable), which scores finished runs without starting new ones;
    - print the server's reason on a 401 or 403 from the start route;
    - **score degraded reports.** A report whose gate status is `completed_degraded` is stored as a `failed` run, but a reader still sees it, so it must be scored. Record the gate status and the degraded reason with the scores. Skip only runs that produced no report;
    - **survive the console closing.** On 1 Oct the pilot process was killed silently when the web console session ended. Write a progress line per run as soon as its outcome is known. Document starting the harness detached from the login session (for example with `systemd-run --unit`), and how to read its log afterwards.

Acceptance:

- A `factual_report` run's system prompts contain neither the knowledge-base block nor the adversarial prefix, and the writer's messages contain no grade words. Assert on the messages actually sent, not on a helper.
- An `adjudication` run's prompts still contain both, and its report opens with a baseline article before the "Challenge" heading.
- A synthetic fixture modeled on the 1 Oct production rail report (do not commit its text) runs through the writer with a mocked model whose draft contains tier tags, `[Quantitative_Quality_Auditor]`, the old front matter and a repeated paragraph. Assert on what is saved: `presentation_clean` 1.0, the repeat gone, the redraft attempted once, the title not "Framing".
- Tests, through the pipeline, for items 2 (fidelity notes are not in the report text), 3 (no internal section name reaches a heading), 6 (no front-matter text in the body), 9 (a forbidden item triggers one redraft and is logged) and 10 (a short request gets a short report with no padding).
- A Layer 1 fixture report begins with a summary of at most 150 words.
- With the classifier stubbed to fail, "What year did the FDA authorize the first CRISPR-based therapy?" routes to `factual_report` and performs discovery.
- Harness on factual and survey tasks:
  - `presentation_clean`, `no_repetition` and the slice 3 part of `structure_complete` all 1.0;
  - `report_quality` at least 4.0;
  - `answer_correct` improves and `time_to_report` does not get worse.
- On challenge tasks, `presentation_clean` is 1.0 and the other challenge scores are unchanged.

### Slice 4. Citations and references (part 1 merged, PR #248)

**Delivered in four parts (2 Oct 2026).** Part 1: the citation core. Part 2: author and publisher metadata and citation styles (the Metadata, Source type and Style bullets, and B4). Part 3: DOI resolution and retraction (the "DOI and retraction" block). Part 4: the quality judge (B3). The acceptance lines below belong to the part that builds what they test.

**As built, part 1.**

- The lock is behind `CITATION_LOCK_ENABLED`, and applies only where `BASELINE_LAYER_ENABLED` is also on and the run is not adjudicative. With `BASELINE_LAYER_ENABLED` unset, a run is as it was. With the baseline on and the lock unset, citations are as slice 3 left them; the one thing part 1 changes there is the status rule in B2 below, which belongs to grant I and to Layer 1, not to the lock.
- The writer's markers are `[P1]`, `[P2]`, not `[E#]`. `[E#]` is already the export engine's alias for a saved citation (`formatting/evidenceAliaser.ts`), which can only be assigned after a report exists; reusing the form for something else would make the two collide.
- Each section is shown whole passages, not quotes cut from them. While the retrieved passages fit a character budget every section sees all of them, so nothing the analysis stages read is hidden from the writer. Only when they do not fit is a section narrowed: a whole-report section sees as many as fit, a subject section the ones closest to its heading and the request, chosen by shared terms. Only two kinds of section are narrowed: a subject heading the outline step named, and one item of a repeated deliverable. Every other section of every format is a whole-report section. The writer is told to state only what the shown passages support. No model call is added.
- A draft that cites a marker it was not shown is drafted once more with the offending markers named. If the second draft still cites one, those markers are removed, the sentence stays, and the removal is recorded on the run and returned as `citationIssues`. It does not fail the run.
- A later rewrite (the coherence refiner, the repetition rewrite, the plain-prose redraft) sees the report text and not the passages. Its version of a section is kept only when every citation still sits on the sentence it was written for, with the same words in the same order (letter case, spacing and punctuation aside). Similarity is not enough: a rewrite that adds "not" keeps nearly every word. The cost is that a rewrite which rewords a cited sentence is discarded for that section, so those passes mostly act on uncited sentences; the repetition and redraft passes may drop a citation with its sentence. When the plain-prose redraft's version of a section is refused, the banned wording in that section is replaced directly with plain words that fit the sentence (in prose and link labels only; code and link destinations are untouched), with its citations left in place, so the refusal cannot let the wording through. After a contract or verifier repair the repaired text is kept and any citation the repair added or moved is removed. A bare number in brackets that the lock did not issue is removed before numbering; code is never touched. The plain-language version carries no citation numbers, because no saved citation is tied to it.
- Markers are read in either letter case; `[p3]` is `[P3]`. Grouped forms a model writes unasked (`[P1/P2]`, `[P1 and P2]`, `[P1–P3]`) are read as the citations they are; a bracket that opens with a marker and cannot be read is removed before saving. That includes a marker the model never closed (`Claim [P1`): the opening token is removed and the words after it are kept. A marker written as link text is bound and the link dropped. A `[Chunk N]` that a later repair writes into a locked report is removed at numbering. The presentation check reads prose only, so a code sample containing a marker is not a failure. A run records on itself that it was written with the lock, and the harness scores from that record, not from the settings of the machine doing the scoring. Marker checks and removals read prose only at every stage, so marker-shaped code is never treated as a citation.
- Switches can be set for one run. An allowlisted admin's `flagOverrides` are recorded in `eval_run_overrides`; the worker reads them once when the job starts and the whole run, and only that run, sees them. This is how the live samples are produced without turning a switch on for customers. A database without that table uses the process settings.
- A locked report never goes to the model-based mapper, including when it cites nothing. The citations are saved in the same transaction as the report and its sections, so a report whose numbers have nothing saved behind them is never committed, even if the worker stops mid-save. A cited passage that is no longer stored fails the save and the run. Saving clears any earlier rows for the report first. Citations are numbered on the exact text that is saved: the save-time clean-up runs before numbering, not after. The verifier and the contract audit read that same finished text (numbers, reference list and closing note in place), not the marker draft, so a contract that asks for a reference list is judged on the report as saved; repairs still work on the marker draft. Code in every Markdown form, links and link definitions are never read as citations or changed. The one exception is a bare number in brackets: in a locked report it is always a citation, so a model-written `[1]: url` line cannot turn it into a link and shield a number the lock did not issue. The definition line itself is left as written. A model-written reference list is removed with its sub-headings. That holds at any heading level; only a level-1 heading that opens the report is taken as its title and kept. Banned phrases are checked as the reader sees them, with each link's label in place, so a link cannot split a phrase out of sight. That covers reference-style links too: the label is read, the identifier after it is not. A heading inside a fenced code sample no longer starts a new saved section, for any report: the sample stays whole, and a citation after it is saved on the section it is in. The harness scores a locked report by its reader numbers: each one must be backed, in order, by a saved row with a passage and a quote. Reader numbers are the only way it is scored: a locked report that cites with an export alias scores nothing, and a saved row the text does not show lowers the score.
- Reader numbers are written into the saved report text, one per stored source (not per title or link, which two uploads can share) in first-citation order, rather than assigned when the page renders. The passage behind each marker is kept in `report_citations`: `citation_order` runs through the whole report in reading order, so it also orders the rows inside a section: the k-th marker in a saved section is the k-th of that section's rows by `citation_order`. One report-wide order is what the harness and a revision read. Slice 5 reads that to show the passage on hover.
- The quote for a citation is the sentence of the passage that shares the most terms with the citing sentence, copied without changing a character. Between two sentences that share the same words, the one that agrees with the citing sentence on negation is chosen. The cited passages are read again inside the revision's save and held until it commits, so a passage deleted while the revision was running drops its citation and does not fail the save. A revision of a locked report carries a citation only where its sentence is unchanged, with its quote, on the section it belongs to, renumbered in the revised reading order; a number on a rewritten or added sentence is removed from the revised text. Sources are then numbered again in the order the revised report first cites them, and its reference list keeps only the ones still cited. Whether a report is locked is read from the run's own record, so a locked report that cites nothing is still treated as locked. Citations of any report now follow the section they came from through a revision, not the section type, which most sections share. A link inside a cited sentence is part of the sentence: its label counts, its destination does not. The same holds for a reference-style link: its label counts, the identifier after it does not. At numbering and in a revision, a number written with spaces (`[ 1 ]`) or as a link (`[1](url)`) is read as the citation the reader takes it for, and is carried or removed like any other; a longer number as a link label (`[2023](url)`) is an ordinary link. The presentation check also reads the label of a link, so `[Chunk 4](url)` fails it; the destination is still not read. A revision of a locked report also removes any passage marker, chunk marker or export alias its rewriter writes, link or not, since none has a saved row. A marker-shaped token inside a source's own text (`[P2]` in a footnote) is shown to the writer in round brackets, so it cannot be cited by mistake, and the same is done to a source's title and publisher, which are kept to one line; the stored passage that quotes are copied from is unchanged. An indented line is read as prose by where it sits, not by what it says: inside a list item, a nested item and a continuation line are prose; a line four or more columns past where the item's text begins is a code block inside the item, and a line with no list item holding it is code. Code is left alone.
- The reference list keeps the slice 3 layout (publisher, title, date, link) until part 2.
- A1: the model-based mapper wrote no rows when the writer cited in a form it did not recognise, and it runs only inside the epistemic-persistence stage, which the reference-lookup profile skips. A locked report no longer depends on it. Reference lookups are slice 7.
- A2 and B1: the presentation check now fails `[Chunk N]`, `[Chunks N, M]`, `CHUNK N`, a leftover `[P#]`, and a bracketed or parenthesised grade word in any letter case. It detects; it does not delete. The save-time clean-up still keeps `[Chunk N]` in reports written with the lock off, because those markers are the only citations such a report has. They stop appearing when the lock is on.
- B2: on a Layer 1 run the plan's fixed source count is recorded on the run, whether or not it was met, and does not set a failed or degraded status. The count-based source check still downgrades a run, except where the material judge read the passages and found them sufficient. The recorded count is of stored sources, so an uploaded file with no link is counted. Verification and the contract audit still decide. Adjudicative runs and switch-off runs are unchanged.
- Not in part 1: the hover card and the reference list on the reading page (slice 5), exports reading the new rows (part 2, with styles), the light synthesis path (slice 7).

**What the live samples showed (4 Oct 2026).** One single-fact question and one broad question, each written with both switches on for that run only.

- What worked: a reader title, a summary that answers first, bracketed numbers that match a reference list in first-citation order, a closing note, a section on disagreement in plain words, and no chunk markers or grade labels.
- Length. The single-fact report was sized at 3,600 words and the broad one at 7,250. In the first case the plan had been revised at the plan screen, outside the run's switches, so it took the report type's standard range. In the second the planner chose it.
- Section size. The words were split evenly, so the summary, the key findings and the limits were each given the same share as a subject section, and the writer filled them. Key findings were paragraphs and the limits ran to many paragraphs.
- Repetition. The same facts were retold in the summary, the key findings, the body, the disagreement section and the limits.
- Doubled numbers. Two passages of one source cited together printed `[1][1]`.
- A cut sentence. The repetition clean-up split a sentence at "et al." and removed the half that repeated an earlier sentence.
- Wording. "Claims", "the evidence establishes", a role of the pipeline named in a sentence and a bare passage label ("P20 notes") reached the reader. The check did not look for the first three, and nothing checked the text after verification and repair.
- Sources. One article stored from two sites was listed as two sources. Reference entries showed stored titles as they were, with markup entities and a "Microsoft Word - … .doc" file name, and no authors.
- Not fixed in slice 4: which sources are found and preferred (slices 6 and 7), and a plain single-fact question being planned as a reference lookup, which the new writing does not reach (slice 7).
- A separate defect: a plan changed from an investigation to a survey at the plan screen still ran as an investigation, with the old layout. The brief kept the method of the first report type.

**As built, part 2.**

- Behind the same two switches as part 1. With `BASELINE_LAYER_ENABLED` unset a run is as it was. The size and wording changes apply wherever the Layer 1 switch is on; the reference details, the numbering changes and the export path apply only with the citation lock as well. The plan-screen fix applies always (grant K).
- No migration. The Metadata bullet below says `sources` has no author or publisher; it has had `authors` and `publication` since migration `001`, unused. Part 2 fills them and adds no column.
- Reference entries: author or publisher, title, date, kind of source in words, link, and for a web page the day it was read. With no publisher a page shows the site it is on. A missing detail is left out. Titles, names and publishers from a provider's record are written as plain text: markup is taken out and a stray angle bracket is written as an entity. The kind is what the provider's own record says the work is ("journal article", "preprint", "book chapter", "dataset"); without one it is read from the address ("scholarly work" for a DOI, "web page", "uploaded document" for a file). This departs from the Source type bullet below, which says "peer-reviewed study" for Crossref and PubMed Central articles: a catalogue entry or a DOI does not establish peer review, so no entry says it. Slice 6 ranks sources and can say more.
- A named style is written as that style writes a reference. It gives the day a web page was read in its own form and has no place for the kind of source, so the kind in words appears in the numbered default only.
- Styles (B4): the numbered default, or APA, MLA, Chicago (both forms), IEEE or Harvard when the user chose one. A style changes how each entry is written, on the page and in every export. The numbers in the text do not change, so every number is still backed by a saved citation.
- Exports of a locked report show the saved text. Asked for another style, only the reference list is written again. If the list cannot be written in that style (a cited source has since been removed), the export is refused with the reason, so no file carries a style it is not in. The export window shows that reason for every format.
- Follow-up after the merge: a wording redraft is held to the same section sizes as the draft it replaces; reference details kept under a stored source's metadata are merged key by key; a pipeline role credited without "the" is read as a leak, and an occupation ("a contract auditor") is not.
- Length: a length nobody chose is capped at 5,000 words, the planner is told the range, and a plan revised at the plan screen is written inside the run's switches. If the run's switches cannot be read the revision fails and can be sent again; it is not written under other settings.
- Section size and shape: see "Section size" in section 5. Key findings not written as a list are asked for once more; if they still come back as paragraphs the sentences are set out as bullets as written, and at most seven are kept. The limits are kept to four sentences, counted across the items when written as a list. After each section is held to its own allowance the whole report is brought back inside its length: sections past their share give up the excess in proportion, at a sentence end. The literature review's own limitations section is held to the same rule. The summary, key findings, disagreement note and limits keep their own size when the user chose a presentation format as well. The refiner is told never to lengthen a Layer 1 report.
- Numbers: side by side, a number is shown once, with one saved citation behind it. Two stored copies of one article share a number and one reference entry when the title of one contains the title of the other and half their retrieved text is the same; both conditions are needed. A copy of a copy takes the first one's number.
- Sentences are no longer split after an abbreviation, an initial, or before a lower-case word, so the repetition clean-up cannot remove half a sentence. A single capital after a label word ("option A.", "Appendix B.") still ends its sentence.
- One address found by two providers is one candidate with the fuller of the two reference records, chosen over the providers' own records so the order they answer in cannot matter. A source already stored by an earlier run is given the details the current run found, filling gaps only. PubMed names ("Smith JA") are stored family name first.
- An export finds the generated reference list as the last section named References, so an earlier section of that name is left alone.
- Wording: see "Wording check" in section 5. A passage label written into a sentence is replaced with "one source" when it names an issued passage and stands before a verb of saying. What cannot be removed is recorded on the run. The wording checks read the report's own sentences only: the generated reference list is never checked for wording or reworded, so a source called "The Case for Nuclear Power" keeps its name. The last wording check before the save runs for every Layer 1 report, with or without the lock. A pipeline role is read as a leak only where a sentence credits it with a finding ("as noted by the …", "the … flagged"), since several role names are real occupations. Terms a subject uses for itself ("copyright claims", "product-liability claim") are left as written.
- Not in part 2: DOI resolution and retraction (part 3), the quality judge (part 4), the reference list and hover card on the reading page (slice 5).

**What the second samples showed (5 Oct 2026).**

- Broad question: inside the length limit, key findings as bullets, a four-sentence limits note, no doubled numbers, no banned wording, no cut sentence, cleaner reference titles.
- Still open on the broad report: one article stored from two sites was listed twice (the copies shared a title but the passages retrieved from each were different, so the text test did not match); the summary and key findings restate each other in different words; web sources carry no authors. The first is for part 3 or slice 6, the second for part 4's judge, the third for slice 6.
- Single-fact question: the writer's draft was correct and cited. The contract check asked for a more direct answer, the repair returned the report as bare sentences with every citation gone, and it was accepted. A second repair appended a section named after the check's complaint, citing a source the run had not read. The run ended failed with no reference list.
- Fix: a repair of a locked report may only cut. It is shown the report and not the passages, so any words it adds come from no source. It is told so, and then held to it section by section. In a section of plain writing (sentences, simple bullets, sub-headings, citations) what is left must be the section's own pieces, character for character and in order, each under the heading it was written under. A section that holds anything else Markdown can do (a link, code, emphasis, a table, a quotation) is taken unchanged or not at all, and so is a whole report that holds a code block. A section the repair left out or emptied stays as it was, and none is added. A locked repair no longer appends sections. Known limits: where the check wants something added or reworded, a locked repair cannot supply it, and the run then ends failed with its cited report intact; giving the repair the passages is later work. A locked repair also cannot remove a whole section, even one the check says does not belong: nothing in the check's result names such a section in a form code can trust, and a repair free to drop sections is the fault the sample showed. Naming them is for part 4.
- Not fixed here: a one-fact question named as a factual report was still planned at 3,600 words, which is what the contract check objected to. The short path for such questions is slice 7.

**Starting point (rev 6).** Slice 3 left an interim scheme: the writer cites `[n]` for `CHUNK n`, `renumberCitations` renumbers by source, and nothing is bound to `report_citations`. This slice replaces the interim scheme with the citation lock below and keeps its two guarantees: one number per source in first-citation order, and no marker without a source. Everything new is gated as invariants 13 and 14 require.

**Carried in from slice 3 (rev 6).** Do A1 and A2 first and put the findings at the top of the PR description before changing code.

- **A1. Why stored reports score zero on binding.** Three reports written on `main` scored `citation_bound` 0 and `quote_verbatim` 0. Establish which is true and show the evidence: `report_citations` rows are not written, or are written without `chunk_id` or `chunk_quote`; the rows exist but `evidence_aliases` do not join; or the score is wrong when called from `--score-run`. State the cause for the iterative synthesis path and for the light synthesis path.
- **A2. Labels still reaching readers.** Stored report text on `main` contains `[Chunk 12]`, `[Chunks 2, 13]`, `(Strong_Evidence)`, `(Testimony)` and `(Inference)`. The presentation check returned clean for the `[Chunk N]` forms. Find where each form enters reader text and whether the PR #242 safety net runs on the saved report or only on display. If labels enter saved reports with every flag off, that is a live defect under PR #242: fix it at the source in this slice and say so.
- **B1. Close the hole in the check.** Add `[Chunk N]`, `[Chunks N, M]`, `CHUNK N` and bracketed or parenthesised grade words in any letter case to the everywhere list in section 8, each with a test. Ordinary prose words ("testimony", "inference") still pass.
- **B2. The fixed source count does not decide Layer 1 (grant I).** The contract audit records `usable_sources_shortfall:N/M` and the run ends failed or degraded even when verification passed every criterion. For a switched-on, non-adjudicative run the count stays in run metadata, does not set a failed or degraded status, and never reaches the reader. Adjudicative runs and switch-off runs are unchanged. Name in the PR description which gate decides in each case; two gates must not deadlock.
- **B3. A quality judge that can tell reports apart.** `report_quality` gave 5 of 5, including 5 for plain neutral prose, to a report that printed grade labels, and 4.8 or higher to three reports the pipeline itself marked short of sources. Rework the judge prompt and add fixtures: a clean, well-cited report must score higher than the same report with grade labels printed, with `[Chunk N]` citations, with one fact repeated in every section, and with no citations. The acceptance test runs the real judge call path with recorded model responses and asserts the ordering. Until it passes, `report_quality` is not used as a gate.
  - **Built in part 4 (6 Oct 2026).** The prompt now names the faults a reader sees (the question not answered first, internal labels in the prose, citations in an internal form, a fact repeated as padding, statements with no citation, disagreement hidden, the wrong length) and says what each score from 5 to 1 means. One clean report is kept as a fixture and the four spoiled copies are made from it in code, one fault each. A script sends all five through the real judge and saves what the model answered; the test replays those answers through the same judge path and checks that the clean report has the higher mean, and the higher score on the point the fault belongs to, every time. The recording carries a fingerprint of the prompt, so changing the prompt without recording again fails the test. Recorded means: clean 5.0, grade labels 4.0, chunk citations 4.5, repeated fact 2.8, no citations 4.3. Known limit: a report with no citations at all still scores 4.3, because five of the six points do not look at citations; the mean alone should not be used to pass a report, and the citation checks stay the guard for that.
- **B4. Citation style follows grant H.** The form offers citation styles. The default is the numeric style described below; a style the user chose governs the reference list on the page and in every export. This replaces "one numeric citation style" in the Style bullet.

Flags `CITATION_LOCK_ENABLED`, `DOI_RESOLVE_ENABLED`. This was slice 5; it moves up because a report without a working reference list cannot meet section 2a.

**Citation lock**, in the existing section drafter in `reasoning/reportGenerator.ts`:

- The drafter's input for a section is that section's item plus the `chunk_quote` rows retrieved for it. No full-corpus context. Inspect how the context is assembled today and narrow it. Do not add outline tables in this slice.
- The model may emit only `[E#]` aliases issued by `evidenceAliaser.ts`. An unknown alias fails the section, which retries once.
- After drafting, the citation mapper binds aliases to `report_citations`. A section with an unbound alias or an empty `chunk_quote` does not pass the verifier.

**Reader numbering.** `[E#]` aliases are internal. When the report is rendered (reading page, exports):

- Each cited **source** gets one number, `[1]`, `[2]`, in order of first citation. Several passages from one source share its number.
- Each marker in the text also carries the id of the passage it cites, so the hover card shows the exact passage behind that sentence, not just the source.
- The reference list is built from `report_citations` joined to `sources`, in that same order. Each entry: authors or publisher, title, date, link and source type in words.
- **Metadata.** `sources` has no author or publisher today. Add nullable `authors` and `publisher` columns (next free migration number) and fill them at ingest where the provider returns them (Crossref, OpenAlex, PubMed Central, arXiv), or from the site name for web pages. A missing field is left out of the entry, never shown as blank or "unknown".
- **Source type.** Until slice 6, derive the type in words from the provider and document kind ("peer-reviewed study" for Crossref and PubMed Central articles, "preprint" for arXiv, "web page" otherwise). Slice 6 refines it.
- **Style.** One numeric citation style for the page and every export, through the existing CSL path. Link the DOI when there is one, otherwise the URL. Web sources show the date they were accessed.
- A report that cites anything always has a non-empty reference list. If binding fails for a section, that section fails through the existing gate with a plain reason. It never reaches a reader with markers and an empty list (today's "No mapped citations available" on a cited report).

**DOI and retraction**, new `backend/src/services/verification/doiResolve.ts`:

- For each citation with a DOI, request `https://doi.org/{doi}` with the existing Crossref user agent, timeout 8s. Try HEAD; on 403 or 405 retry with GET. Store the result in a new nullable `resolve_status` on `report_citations`.
- 404 or network failure marks the citation `unresolved`. The verifier may not count it as support.
- Check for retraction or correction notices using the Crossref record, and Scite when it is keyed. Store a nullable `editorial_notice`. A retracted source may be cited only with the retraction stated in the sentence, in plain words ("a 2019 study, since retracted, reported…").
- When OpenAlex or PubMed Central offers an open full-text PDF, ingest it through the existing file pipeline and prefer its chunks over the abstract.
- A statement whose only support is an abstract, when full text was available and unused, gets the lower internal grade. This is internal only.

**Built in part 3 (5 Oct 2026).** Behind `DOI_RESOLVE_ENABLED`, which is on only where the citation lock is on. Each source with a DOI (from the provider's record, else from its address) is checked once per run against the DOI resolver: HEAD, then GET on 403 or 405, 8 seconds. The resolver's redirect is the answer and is never followed. Only a page or a redirect counts as resolved; "not found" and "gone" are unresolved; a fault, refusal, rate limit or timeout is no answer. The check runs on passages as they are retrieved (first retrieval, each specialist's own search, and any later search), before any stage reads them, so a source the resolver does not know, or that got no answer, is never seen by the analysis, the gates or the writer and cannot be cited or counted. If two or more were asked and none got any answer, the check is treated as unavailable and nothing is set aside. A failed check never stops a run. A retraction or correction is read from the Crossref record of the cited work (`updated-by`). A retracted source stays, flagged to the writer; a sentence citing it must say the work was retracted, in the same part of the sentence as the citation (the bare word as a topic, a denial, or a retraction put as a possibility does not count; one statement covers one retracted work), the section is redrafted once if not, and the citation is taken off any sentence that still does not, including after later rewrites. What the check found is saved beside each citation (`resolve_status`, `editorial_notice`, migration 059; saved in the citation transaction, tolerating the migration not being applied; carried into revisions). The run records what the check found per distinct DOI, sources set aside included, and the harness `doi_resolution` score is the share of answered DOIs that resolved. The short reference-lookup path is not locked: unresolved sources are set aside there too, but the retraction rule, which works on locked passages, is not applied. Not built, left for a later part: Scite, ingesting open full-text PDFs, and the abstract-only grade. Corrections are recorded and not shown to the reader yet.

Acceptance:

- The drafter prompt for a fixture section contains quotes for that section only.
- A section citing an alias it was not given fails and retries once.
- A fixture report with three passages from two sources renders `[1]` and `[2]` only, with a two-entry reference list in first-citation order, and each marker resolves to its own passage.
- A Crossref source with authors renders them; a web page without authors shows its site name and access date, and no "unknown".
- A fixture cited report with a failed binding never renders an empty reference list.
- Mocked DOI: 200 passes, 404 fails support, 405-then-200 passes.
- A fixture retracted source cannot be cited without the retraction in the sentence.
- Harness: `citation_bound` and `quote_verbatim` 1.0, `quote_supports` at least 0.90, `doi_resolution` 1.0, `structure_complete` 1.0.

### Slice 5. Reading page and exports (not started)

Flag `READER_VIEW_ENABLED`, read in the backend and sent to the frontend with the report payload. New slice. Today's reading page (`frontend/src/pages/ReportDetailPage.tsx`) shows the machine's view of a run. This slice makes it show the section 2a report.

1. **Report tab, the default.** Shows only the section 2a report: title, summary, key findings, body, disagreements, limits, references, "About this report".
   - Remove from this view: the contradictions card, the counterevidence and falsification card, the evidence-coverage card, the report-status card, the run-reference card, the "Falsification criteria" block, raw status values, duplicated headings, and the generation trace.
   - Nothing here may show an item from the section 2a never-list.
2. **Citations.** Bracketed numbers. Hover, keyboard focus or tap shows the source title, publisher, date and the quoted passage behind that sentence. Each number links to its reference entry. Works on a phone.
3. **Other tabs**, after Report:
   - **Evidence** (grant F): each finding with its sources, quoted passages, source type and strength in plain words. This is the only place strength appears.
   - **Sources**: the full reference list with metadata.
   - **How this was researched**: plan, searches, run reference, generation trace, model information.
   - **Challenge**: from this slice, a report with a Challenge section shows it here, not in the Report tab. Slice 8 replaces its content with the ledger.
   - For runs that store no findings (`reference_lookup`), the Evidence tab lists each cited passage with its source instead.
4. **Status words.** People read "Ready", "Needs review", or "Failed" with a plain reason. The plain sentences already exist in `reasoning/runStatusDisplay.ts`; use them. Never `under_review` or any enum.
5. **Revision and spinoff controls** sit in an actions menu or below the report, not inside it.
6. **Older reports.** Reports saved before slices 3 and 4 still open cleanly. The safety net applies. `[Chunk N]` markers become reader numbers where `report_citations` maps them, and are hidden where it does not. No report shows "Chunk".
7. **Exports.** PDF, Word and Markdown exports render the same section 2a report, with numbered citations and the reference list, and none of the never-list. Use the existing export stack (Pandoc, CSL).
8. **App wording.** Reader-facing app text that calls report content "claims" changes to "findings": the corpus sidebar counter, the public sample report (`SampleReportView.tsx`, which shows a claims table with grade tags; it must show a section 2a report), the landing-page comparison table ("Per-claim citations", "Cited counter-claims") and the live progress view (stage names become reader words such as "Searching sources" or "Writing the report"). Extend the existing banned-jargon gate, or add one beside it, so the tier words and "claim" or "claims" fail CI in reader-facing frontend strings. Internal identifiers and API field names do not change.
9. **Tests that pin the old panels** may be updated in this slice under grant G. List each one in the PR description with the reason.
10. **Keep what works.** Share links and copy-to-Markdown, where they exist, keep working and carry the same clean report.
11. **One presentation mapper for every reader-facing report projection.**
    - Today the clean-up from PR #242 is applied piecemeal: report detail, exports, revision detail and report metadata.
    - Replace that with one mapper in `formatting/reportPresentation.ts` that every endpoint returning report text to a reader goes through. That includes the report list (`GET /api/reports`), dossier list and history endpoints, spinoff prefill and context, and any picker or card showing a report title.
    - Also clean on write: the revision save path (`createReportRevision`, section titles and bodies) and any stored reader field, such as `falsification_criteria`, so stored text is clean, not only rendered text.
    - A test enumerates the report-returning routes and fails if one bypasses the mapper.

Acceptance:

- A component test renders a fixture report containing tier tags, `[Chunk N]` markers, internal step names, `under_review` and the old front-matter text. The Report tab contains none of them; the Evidence tab shows the strength in words.
- Hovering a citation shows the quoted passage.
- A legacy fixture with unmapped `[Chunk N]` markers renders no "Chunk".
- The Markdown handed to Pandoc for PDF and Word, and the Markdown export, contain no never-list item and include the reference list. Assert on that Markdown in CI; Pandoc itself need not run in CI.
- The sample report page and the landing comparison table contain no "claim" or "claims" and no grade tags.
- The jargon gate fails on a reader-facing string containing "claims".
- Harness: `pairwise_vs_reference` at least 0.5 on tasks with a reference report; `report_quality` at least 4.0.

### Slice 6. Source authority (not started)

Flag `AUTHORITY_TIERS_ENABLED`. This was slice 4.

- New nullable column `authority_tier` (1 to 4) on sources, next free migration number. Computed at ingest, deterministically, from provider and domain:
  1. Primary and official: government, regulators, courts, standards bodies, statistical agencies, registries, original datasets, the original document itself.
  2. Peer-reviewed scholarly work.
  3. Preprints, established news organizations, reference works, recognized institutional reports.
  4. Everything else.
- The domain and provider rules live in one config file with a test per rule. No model call.
- This is separate from `evidence_tier` (a grade on a stored finding) and from the discourse label in `sourceClassTypes.ts`. Do not merge them.
- Layer 1 retrieval orders candidates by relevance first, then tier. The writer is told to prefer higher-tier sources when sources conflict, and to say so in words.
- **Where the reader sees it.** The tier is never printed beside a citation and never appears in report text. It shows only:
  - as a source type in words ("government report", "peer-reviewed study") in the reference list and the citation hover card;
  - on the Evidence tab.
- Layer 2 does not treat tier as proof. It records the tier and examines the information anyway.
- Never exclude a source because of its tier (invariant 7).

Acceptance:

- A `.gov` regulator page is tier 1, a Crossref journal article tier 2, an arXiv preprint tier 3, an unknown blog tier 4.
- With two equally relevant chunks, Layer 1 retrieval returns the higher tier first.
- A tier 4 source that is the only source for a point is still cited.
- No tier number ("tier 1" to "tier 4", "T1") and no tier word used as a label appears in report text or beside a citation. Source type in words is allowed in the reference list and hover card. `presentation_clean` stays 1.0.
- Harness: `authority_share` rises on factual tasks; `answer_correct` and `report_quality` do not fall.

### Slice 7. Provider routing by request (not started)

Flag `PROVIDER_ROUTING_ENABLED`. This was slice 6; unchanged except for numbering.

- **Reference lookups join the baseline (rev 6, issue #244).** `reference_lookup` uses the light synthesis branch, which the baseline switch does not change: fixed dossier headings, no automatic length, no bound citations, no reference list, no closing note. In this slice the lookup path produces the section 2a report through the same writer, with a test that a switched-on lookup has the reader layout.
- Add `selectProviders(brief)` in the discovery layer. It **replaces** `SPECIALIST_CONNECTOR_KEYS`. With the flag on, the specialist mapping is not consulted. Do not leave two routing systems active together. Do not create a second provider interface.
- Routes:
  - scientific or medical: OpenAlex, Crossref, PubMed Central, ClinicalTrials, arXiv, then general web.
  - patent: USPTO, OpenAlex, then general web.
  - market or opportunity: Parallel plus general web. No arXiv, PubMed Central, USPTO or ClinicalTrials unless the request itself is technical.
  - code or repository: general web with a `site:github.com` variant.
  - Layer 2 runs: all relevant routes above, plus Brave when keyed, plus the anomaly query template in `deterministicDiscoveryQueries.ts`.
  - default: general web, OpenAlex, Crossref, plus one query variant aimed at official and primary records.
- Keep the multi-provider web cascade. One provider failing must not fail the run when another returned results. Log provider errors to `discovery_events`.
- Raise config defaults to 12 queries and a 24-source floor. The ceiling of 40 in `sourceBudget.ts` does not change.

Acceptance:

- A clinical question does not call USPTO.
- A market question does not call arXiv or PubMed Central.
- A Layer 2 question includes the anomaly template.
- With the flag on, a run that schedules a data-analysis specialist on a market question still does not call the academic providers. Test through the orchestrator.

### Slice 8. Challenge layer (not started)

Flag `CHALLENGE_LEDGER_ENABLED`. This was slice 7. This is where PolicyOne does its work.

- **When it runs.** Automatically after the baseline for `policyone` runs. On request for any finished report, through a "Challenge this report" action that reuses the sources already ingested for that report and may discover more within budget. Use the existing run-lineage mechanism; do not invent a second one.
- **Input.** The baseline's stored findings (the `claims` rows; the table keeps its name internally).
- **Per finding:**
  - **Independence.** Group the finding's citations by origin: same DOI, same canonical URL, near-identical text, or all citing one upstream document. Record `independent_origin_count`. Ten articles repeating one release count as one.
  - **Primary trace.** Is there a tier 1 record behind it? Record yes, no, or not found.
  - **Contradiction search.** Run the anomaly and falsification query templates. Keep everything found.
  - **Perspectives, as data:** `{name, stake, questions[]}`, at most 3 questions each, with these four slots always present: official record, primary source, marginal or anomalous report, what would be true if the outlier held. Questions become extra retrieval within budget, otherwise checklist items for the adversarial pass. Write a new prompt in `SYSTEM_PROMPTS`. Do not import prompts from other projects.
  - The existing adversarial pass and steelman run here, unchanged, with `withPreamble` and `CHALLENGE_PASS_SYSTEM_PREFIX`.
- **Stored output.** New table `claim_challenges`: `claim_id`, `run_id`, `status` (`holds`, `contested`, `unsupported_at_primary`, `open`), `independent_origin_count`, `primary_trace`, `notes`, `evidence_ids`. Internal names may stay.
- **What the reader sees.** The **Challenge** tab from slice 5, now filled from the ledger, and a "Challenge" section after the baseline in exports. Written in the section 2a voice: plain prose, numbered citations, no grade labels, no enum values. Statuses appear as words:
  - "Holds up"
  - "Sources disagree"
  - "No primary record found"
  - "Still an open question"

  It refers to "what the report says" or "this finding", never to "claims". A short summary lists which findings changed status and why. The baseline text is never rewritten.
- **Missing evidence.** Status `open`, with a possibility described as a possibility (invariant 8). Never written as a finding.
- **Challenge intents.** Slice 3 already reworded the `adjudication`, `investigation` and `story_verification` templates. Keep that voice. The user's own question may be quoted as the question being tested; the report still presents information, not a trial.
- **Words.** "Challenge" everywhere a person reads. Never "skeptic".

Acceptance:

- Three citations that all quote one press release give `independent_origin_count = 1`.
- A finding with a contradicting ingested chunk becomes `contested`, and a `contradictions` row exists.
- A finding with no contradicting or primary evidence becomes `open`, never `unsupported_at_primary` and never a finding of suppression.
- The baseline section of the report is byte-identical before and after the challenge.
- The perspectives fixture always contains the anomalous slot.
- Triggering the action on a finished `factual_report` produces a ledger without re-ingesting existing sources.
- The Challenge tab of a fixture shows status words and no enum or grade label.
- Harness:
  - `contradiction_retention` and `anomaly_retained` at 1.0;
  - `presentation_clean` 1.0 on challenge tasks;
  - factual-task scores unchanged.

### Slice 9. Research tree and outline operations (not started)

Flags `RESEARCH_TREE_ENABLED`, `OUTLINE_OPS_ENABLED`. This was slice 8. Do not start until slices 3 to 8 are merged and the harness is green.

Tree, new `planning/researchTree.ts`, tables `research_trees` and `research_tree_nodes`:

```ts
type ResearchNode = {
  id: string;
  parentId: string | null;
  question: string;
  depth: number;
  status: 'pending' | 'retrieved' | 'sufficient' | 'blocked';
  providerIds: string[];
  sourceIds: string[];
};
```

- Layer 1: breadth 3, depth 1. Layer 2: breadth 3, depth 2, plus one anomaly node and one falsification node. Layer 1 nodes carry no hypothesis fields.
- One BullMQ job per node, concurrency 4. After each wave, a cheap JSON-only gap check may add children while depth allows.
- Stop when every leaf is `sufficient` or `blocked`, or the source budget is spent, or the wallet hold is spent.
- Socket event `tree:node` with id, status, source count. A missing UI must not block the API. Any progress view shows reader words ("Searching", "Enough sources found"), never node statuses.

Outline operations, table `report_outline_nodes` (`id`, `run_id`, `parent_id`, `intent`, `evidence_ids uuid[]`, `op`, `revision`):

- **expand:** split a node with more than 8 evidence ids and two distinct sub-questions.
- **contract:** merge siblings whose evidence ids overlap by Jaccard > 0.7.
- **revise:** Layer 2 only. When the adversarial pass contradicts a node's intent, rewrite the intent and keep both evidence sets. Never delete contradicted evidence ids.

Acceptance:

- A depth-2 fixture creates at most `breadth * (1 + breadth)` nodes, plus the two Layer 2 nodes.
- Budget exhaustion marks remaining nodes `blocked` and still delivers a report whose "Limits of this report" names the gaps in plain words.
- A Layer 2 fixture always has an anomaly node. A Layer 1 fixture never has one.
- A revise operation keeps the pre-revision evidence ids.
- Harness: `tokens` p50 at most 1.5x the starting point. `time_to_report` on factual tasks does not get worse. `report_quality` does not fall.

### Slice 10. Calculated numbers (not started)

Flag `QUANT_CHECK_ENABLED`. This was slice 9. Extend `reasoning/deterministicQuant.ts`. Do not create a second module.

- Runs only when the report has numeric statements or the user asked for a calculation.
- Operations: `sum`, `mean`, `median`, `rate`, `difference`, `ratio`, over inputs extracted from sources into a `quant_inputs` jsonb.
- Arithmetic runs in Node. No model does the math. Store expression, inputs and output in `quant_results`.
- The drafter may use a calculated result only through its id. The verifier recomputes it.
- The reader sees the number, with a short note in words ("calculated from [3] and [5]"). Never the id.

Acceptance:

- A number supplied by the model that is not in `quant_inputs` is rejected.
- A recompute mismatch fails the verifier.
- The rendered report shows the calculated number with its source note and no internal id.

### Deferred. Do not build

Read-only MCP servers. Free-form Python or any code-execution container. Any new default model taken from an outside report.

## 10. Non-goals

- Rebuilding Clerk, Stripe, wallet holds or BYOK.
- Haskell, xelatex or a second export stack.
- Publisher, quartile or venue bans.
- Thousands of agent calls. Budgets are the design.
- Public copy that presents PolicyOne as the product.
- Any change to cost accounting or the monthly quota.
- Email to anyone.

## 11. When to stop and ask Brandon

- A fact in section 5 is no longer true.
- A slice's target scores do not move, or any score regresses.
- A change would touch a fenced item in section 6, or go beyond a permission in section 7.
- A harness run needs spend approval.
- CI is not running or not green.
- You find a defect outside the slice. Record it for Brandon. Do not fix it inside the slice and do not ignore it.
- A report would show a reader anything on the section 2a never-list, and you cannot remove it inside the slice.

Ask one plain question with your recommendation. Do not guess.

## 12. Done

With all flags on, in harness runs:

- Layer 1: `answer_correct` >= 0.90, `citation_bound` 1.0, `quote_verbatim` 1.0, `quote_supports` >= 0.90, `doi_resolution` 1.0, and `time_to_report` on factual tasks better than the starting point.
- Reader quality: `presentation_clean`, `structure_complete` and `no_repetition` 1.0 on every task; `report_quality` >= 4.0; `pairwise_vs_reference` >= 0.5 and rising.
- Layer 2: `contradiction_retention` 1.0, `anomaly_retained` 1.0, and every challenged finding carries a ledger status.
- `tokens` p50 <= 1.5x the starting point.
- A baseline report reads like a well-written encyclopedia entry or review article (section 2a), shown by `report_quality` >= 4.0 and `pairwise_vs_reference` >= 0.5: answer first, numbered citations, a full reference list, no labels, no claims language, no adversarial framing. Evidence strength lives only on the Evidence tab. The Challenge appears only on its own tab and section, when it ran.
