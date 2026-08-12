# WO-Z — Report-type fidelity across the whole ResearchOne surface

**Status:** OPEN
**Opened:** 2026-08-12
**Owner:** autonomous coding agent (Copilot / Cursor / Codex)
**Governing rules:** 37 (intent contracts), 40 (corpus competence gate),
20 (research policy), 16 (tests must fail without the fix), 32 (PR branch)

---

## 1. Executive statement

ResearchOne must produce the report the user asked for — a comparison, an
opportunity portfolio, a how-to, a literature review — using the vocabulary,
structure, and agent roster appropriate to that speech act.

It must **not** apply claim-adjudication machinery to every request.

**PolicyOne remains fully intact and fully important.** It is the correct
methodology for adjudication, investigation, story verification, and any
run the user explicitly routes to it. This
work order narrows *when* PolicyOne fires. It does not weaken *what*
PolicyOne does. Any change that reduces PolicyOne's strength on its own
intents is a regression and must be reverted.

---

## 2. The failing run (reference incident)

| Field | Value |
| --- | --- |
| Run ID | `178fea66-6114-4f53-aeba-16dd825a6f52` |
| Date | 2026-08-12T09:31:41Z |
| Declared intent | `opportunity_discovery` (primary), `feasibility` (secondary) |
| Classified intent | `comparative` ❌ |
| Recorded objective | `GENERAL_EPISTEMIC_RESEARCH` |
| Output layout | `Dimensions Table / Per Option / Recommendation Optional` |
| Duration | 26m 36s |
| Tokens | 152,235 |
| Gate status | `verification_failed` |
| Deliverable | Zero of 20 requested opportunities. A ~6,000-word essay arguing the report could not be written. |

The user's prompt explicitly said *"Do not reinterpret this request as a
general factual report"* and *"Do not end with vague advice such as 'do more
research.'"* The report did both.

---

## 3. Proven root causes

Each cause below was reproduced against the code at commit `5ebc1d7`
(PR #198 merged). These are not hypotheses.

### RC-1 — Markdown emphasis defeats explicit intent declaration `[PRIMARY]`

**File:** `backend/src/services/planning/intentClassifier.ts`
**Function:** `resolveIntentAlias()`

`explicitDeclarationLayer()` correctly matches the user's declaration:

```text
input    : "Primary research intent: **opportunity_discovery**"
regex    : /(?:primary\s+research\s+intent|...)\s*[:=]\s*([^\n.,;]+)/gi
captured : "**opportunity_discovery**"     ← includes the markdown bold markers
```

`resolveIntentAlias()` then tries four lookups against `INTENT_ALIAS_MAP`:
exact, underscores→spaces, trailing-noun-stripped, and both. **None strips
markdown emphasis, backticks, or quotes.** Reproduced result:

```text
"**opportunity_discovery**"    => null   ← DROPPED
"**feasibility**"              => null   ← DROPPED
"*opportunity discovery*"      => null   ← DROPPED
"`opportunity_discovery`"      => null   ← DROPPED
"\"opportunity_discovery\""    => null   ← DROPPED
"__opportunity_discovery__"    => null   ← DROPPED
"opportunity_discovery"        => opportunity_discovery   ← only bare form works
```

With the declaration dropped, classification fell through to
`lexicalLayer()`, which counts trigger-pattern hits. The prompt contains
"comparison-site", "comparison", "compare", and "X vs Y" dozens of times,
so `comparative` won on hit count and `opportunity_discovery` lost.

**This single missing normalization inverted the entire run.** It also
violates Rule 37 R-A, which already requires explicit declarations to
resolve at confidence ≥ 0.95.

Users write markdown. Every declaration form must survive it.

### RC-2 — Verifier appends epistemic criteria to every intent

**File:** `backend/src/services/openrouter/openrouterService.ts`
**Function:** `buildVerifierPromptForIntent()` (~line 1473)

After injecting the correct per-intent rubric, the function appends:

```text
Additionally for all report types:
- Every major claim must have an evidence tier tag: (established_fact), ...
- No unsupported facts. If the corpus was silent on a point, the report must say so.
- Citations must exist for all nontrivial factual assertions.
```

These are exactly the four extra criteria that appeared in the failed run's
verification output beyond the four `comparative` ones. The verifier is
instructed to demand `(established_fact)` tags on a market-opportunity
report, so the synthesizer and the repair passes produce them by the
hundred. This is the mechanism behind the vocabulary the PR-198 scrub was
meant to eliminate: PR #198 removed the words from display surfaces while
this block still **mandates** them at generation time.

### RC-3 — No corpus competence gate

**File:** `backend/src/services/retrieval/retrievalService.ts`

`retrieveChunks()` runs with `minSimilarity = 0.3` — a floor low enough that
a query about affiliate niches matched the operator's own project notes
about Shopify validation and microservice architecture. Every `CHUNK`
citation in the failed report is the user's own uploaded documentation,
cited as though it were market evidence.

There is no notion of whether the corpus is *competent* on the topic being
asked about, and no guard against self-referential sources.

### RC-4 — Discovery results never reach reasoning

Trace timing:

```text
09:35:58  discovery_round_1_complete   (140 candidates after dedup)
09:36:02  retrieval_started            (+4 seconds)
```

Four seconds is not enough to fetch, chunk, and embed 140 documents.
Retrieval is corpus-only (`retrieveChunks`), and the comment at
`researchOrchestrator.ts` STAGE 3 claims it "now includes discovery
sources" — which is only true if ingestion has completed and embeddings
exist. It had not. The 140 candidates contributed nothing.

### RC-5 — No evidence-sufficiency gate before synthesis

All four specialists reported zero usable data:

```text
Data Analysis Specialist : "Relevant Data Points Extracted: 0"
Quantitative Auditor     : "Source verification for critical claims: fail"
Competitor Mapper        : "No actual competitive landscape data exists for any vertical"
```

Specialists finished 09:38:18. Synthesis started 09:42:45 anyway. The
pipeline spent 26 minutes and 152k tokens writing an essay about why it
could not write the report, then failed two bounded repair passes that had
no new information to work with.

### RC-6 — Refusal is not a failure mode in most rubrics

`intent_opportunity_discovery.verifierRubric` already contains the correct
clause:

> *FAIL if: … the report refuses to rank because evidence is imperfect
> (uncertainty should be labeled, not used to abort the deliverable).*

No other rubric has it. The `comparative` rubric passed the refusal on 6 of
8 criteria. Refusal-to-deliver must be a FAIL condition for every
non-adjudicative intent.

### RC-7 — Report title and body are polluted by the prompt

The report `H1` is the first ~200 characters of the raw query, and the
entire ~700-line prompt is prepended to the report body before the
generated content begins.

---

## 4. Scope

**In scope:** intent declaration parsing; verifier rubric scoping; refusal
handling; corpus competence gating; discovery→retrieval ordering;
evidence-sufficiency gating; report title/echo hygiene; tests and docs for
all of the above.

**Out of scope (do not start without a new work order):** billing, tiers,
Stripe, auth, the frontend redesign phases, export/CSL formatting, and any
change to the *text* of `REASONING_FIRST_PREAMBLE` or
`RED_TEAM_V2_SYSTEM_PREFIX`.

**Explicitly preserved:** PolicyOne behavior on `adjudication`,
`investigation`, `story_verification`, and any run with
`resolvedMethodology === 'policyone'`.

---

## 5. Execution phases

Work the phases in order. Each phase is independently committable and has a
hard exit gate. Do not begin a phase until the previous phase's gate passes.

Per Rule 16, **write the failing test first** in every phase, confirm it
fails against unmodified source, then implement.

### Phase 1 — Declaration token normalization (fixes RC-1)

**Target:** `backend/src/services/planning/intentClassifier.ts`

1. Add a `normalizeDeclarationToken()` helper that strips, in order:
   surrounding whitespace; markdown emphasis (`**`, `__`, `*`, `_` when
   they wrap the whole token); backticks; straight and curly quotes
   (`"` `'` `"` `"` `'` `'`); and trailing punctuation (`.`, `,`, `;`, `:`).
   Preserve interior underscores — `opportunity_discovery` must survive.
2. Call it at the top of `resolveIntentAlias()`, before the existing
   four-stage lookup.
3. Capture the **secondary** intent. The reference prompt declares
   `secondary research intent` on a following line as `**feasibility**`;
   it is currently discarded. Extend `explicitDeclarationLayer()` to
   populate `ResearchBrief.secondaryIntent` when a secondary declaration
   is present.
4. Broaden the labelled-declaration regex to tolerate a newline and
   markdown between the label and the value, e.g.
   `Primary research intent:\n\n**opportunity_discovery**`.

**Exit gate:**

- New test file `backend/src/__tests__/intentDeclarationNormalization.test.ts`
  asserts every form resolves: bare, `**bold**`, `*italic*`,
  `__underscored__`, `` `code` ``, `"quoted"`, `'quoted'`, trailing-period,
  and value-on-next-line.
- Test asserts the reference prompt from §2 resolves to
  `opportunity_discovery` with confidence ≥ 0.95 — **not** `comparative`.
- Test asserts secondary intent resolves to `feasibility`.
- Each test fails against unmodified `intentClassifier.ts`. Verify by stash.

### Phase 2 — Verifier rubric scoping (fixes RC-2, RC-6)

**Targets:** `backend/src/services/openrouter/openrouterService.ts`,
`backend/src/services/formatting/templates/intentOutputTemplates.ts`

1. **Delete** the `Additionally for all report types:` block from
   `buildVerifierPromptForIntent()`.
2. Move evidence-tier-tag requirements into the `verifierRubric` of only
   the intents that warrant them: `adjudication`, `investigation`,
   `story_verification`, `factual_report`, `literature_review`,
   `survey`, `timeline`.
3. Replace the deleted block with a genuinely universal minimum that is
   speech-act neutral:
   - No fabricated specifics. Unknown values are labeled unknown.
   - Nontrivial external facts carry a source reference.
   - Stated user constraints are respected.
   - **The requested deliverable is produced.** Uncertainty is labeled,
     never used to abort delivery.
4. Add the refusal-is-failure clause (RC-6) to the `verifierRubric` of
   every non-adjudicative intent: `comparative`, `feasibility`,
   `implementation`, `recommendation`, `how_to`, `exploratory`,
   `reference_lookup`, `factual_report`, `literature_review`, `survey`,
   `timeline`.
5. `buildVerifierPromptForIntent()` currently defaults `isAdjudicative = true`.
   Change the default to `false` so an omitted argument cannot silently
   select the adjudicative preamble. Grep both call sites in
   `researchOrchestrator.ts` (~lines 1417 and 1675) and pass explicitly.

**Exit gate:**

- Test asserts the built verifier prompt for `comparative`,
  `opportunity_discovery`, `how_to`, and `implementation` contains **no**
  occurrence of `established_fact`, `falsification`, or `contradiction
  analysis`.
- Test asserts the built prompt for `adjudication` and `investigation`
  **does** contain the evidence-tier and falsification requirements after
  the shared-footer replacement — the adjudicative rubric must be
  preserved.
- Test asserts `literature_review` retains its evidence-tier requirements
  **and** fails refusal-to-deliver.
- Snapshot test pins the adjudication verifier rubric so future edits
  cannot silently weaken it.

### Phase 3 — Corpus competence gate (fixes RC-3)

**Governing rule:** `.cursor/rules/40-corpus-competence-gate.mdc` — read it
before starting. It defines the required semantics; this phase implements
them.

**Targets:** `backend/src/services/retrieval/retrievalService.ts`, new
`backend/src/services/retrieval/corpusCompetenceGate.ts`, new migration.

1. Implement partition resolution, threshold evaluation, sealed/unsealed
   status, and the non-citable background demotion described in Rule 40.
2. Raise the default `minSimilarity` floor from `0.3`. Make it
   configurable and set the default no lower than `0.55`. Record the
   effective value in run metadata.
3. Implement the self-referential source guard: sources owned by the
   requesting user (private uploads, `discovered_by_run_id` from this
   user's own runs) must not be presented as independent external
   evidence for market, competitive, pricing, or regulatory claims.
4. Persist the gate decision to run metadata so any report can be audited
   for which partitions were sealed and why.

**Exit gate:**

- Test: a sealed partition returns zero citable chunks and sets
  `corpusGate.status = 'sealed'` in run metadata.
- Test: an unsealed partition retrieves normally.
- Test: reconstruct the failed run's corpus shape (user's own project docs
  only, no independent domains) and assert the partition evaluates
  **sealed** — i.e. the incident cannot recur.
- Test: `minSimilarity` default is ≥ 0.55.
- Migration is idempotent and tolerates being unapplied (Rule 13).

### Phase 4 — Discovery ingest barrier (fixes RC-4)

**Target:** `backend/src/services/reasoning/researchOrchestrator.ts` STAGE 2→3

1. After `runDiscoveryOrchestrator()` returns, await a bounded readiness
   barrier: discovered sources must be chunked **and** embedded before
   STAGE 3 retrieval begins.
2. Bound the wait (configurable, default 120s). On timeout, proceed but
   emit a progress event naming how many discovery sources were not yet
   queryable, and record it in run metadata.
3. Emit a progress substep (`discovery_ingest_ready`) so the failure is
   visible in the run trace instead of being silent.

**Exit gate:**

- Test asserts retrieval does not execute until the barrier resolves.
- Test asserts timeout path proceeds, warns, and records the shortfall.
- Test asserts `sourcesIngested === 0` produces a loud, traceable event —
  the failed run logged this silently.

### Phase 5 — Evidence-sufficiency gate (fixes RC-5)

**Target:** `backend/src/services/reasoning/researchOrchestrator.ts`,
between specialist execution and synthesis.

1. After specialists run, compute a sufficiency verdict from their
   structured output (usable data points, source verification results,
   citable chunk count after the Phase 3 gate).
2. If insufficient **and** discovery rounds remain: loop back to discovery
   with reformulated queries derived from the specific gaps the
   specialists named. Do not re-run identical queries.
3. If insufficient **and** rounds are exhausted: for non-adjudicative
   intents, proceed to synthesis under an explicit
   `low_evidence_labeled_delivery` mode — deliver the requested artifact
   with clearly labeled confidence and stated assumptions. **Do not
   substitute an essay about why the deliverable is impossible.**
4. Never enter the bounded repair loop when the failure cause is data
   absence — repair without new information cannot succeed and burned two
   passes in the reference incident. Route to re-discovery instead.

**Exit gate:**

- Test: zero-usable-data specialists trigger re-discovery, not synthesis.
- Test: exhausted rounds + non-adjudicative intent produce a labeled
  deliverable containing the requested artifact count.
- Test: repair loop is not entered when the failure reason is
  `insufficient_evidence`.
- Regression test using the §2 reference prompt asserts the run produces 20
  ranked opportunities, or fails with an actionable reason — never a
  refusal essay.

### Phase 6 — Report hygiene (fixes RC-7)

**Targets:** `backend/src/services/reasoning/reportGenerator.ts`, dossier
read path.

1. Generate a real report title. Never use a truncated raw query as `H1`.
2. Do not prepend the user's prompt to the report body. Preserve it as
   run metadata / the Request tab, which already exists in the dossier UI.

**Exit gate:**

- Test asserts a report whose query exceeds 200 characters still receives a
  generated title of reasonable length.
- Test asserts the rendered report body does not contain the verbatim
  prompt.

---

## 6. Global acceptance criteria

The work order is complete when all phase gates pass **and**:

- [ ] `npm run typecheck`, `npm run lint`, `npm run test` pass in `backend/`.
- [ ] Frontend checks pass if any frontend file changed.
- [ ] `npx markdownlint-cli2 "docs/**/*.md"` passes.
- [ ] Rule 37 pre-commit checklist is walked and every box is honestly ticked.
- [ ] Rule 40 pre-commit checklist is walked.
- [ ] A regression fixture for the §2 reference prompt exists in the test
      suite and asserts: intent = `opportunity_discovery`; secondary =
      `feasibility`; verifier prompt free of adjudicative vocabulary; 20
      opportunities delivered; no refusal.
- [ ] PolicyOne snapshot tests prove adjudicative prompts preserve their
      adjudicative rubric and required evidence/falsification constraints
      after the shared-footer replacement.
- [ ] Every out-of-scope finding is logged in §8, not silently dropped.

---

## 7. Progress log

Append one row per completed phase. This is how state survives across
sessions — a new agent reads this table to know where to resume.

| Phase | Status | Commit | Date | Notes |
| --- | --- | --- | --- | --- |
| 1 — Declaration normalization | DONE | `624a7c5` | 2026-08-12 | Normalized explicit declaration tokens, captured secondary intent, and added the markdown/quote/newline regression matrix. |
| 2 — Verifier rubric scoping | DONE | `8d28df8` | 2026-08-12 | Removed the universal epistemic footer, moved intent-specific verifier requirements into templates, added refusal FAIL coverage, and pinned the adjudication prompt snapshot. |
| 3 — Corpus competence gate | DONE | `f300130` | 2026-08-12 | Added partition-aware corpus gating, configurable similarity floor, self-source suppression for market-style intents, auditable gate metadata, and the partition-key migration. |
| 4 — Discovery ingest barrier | DONE | `f300130` | 2026-08-12 | Added a bounded queryable-source barrier between discovery and retrieval, plus timeout/no-ingest telemetry persisted to run metadata. |
| 5 — Evidence-sufficiency gate | DONE | `f300130` | 2026-08-12 | Added insufficiency assessment, targeted re-discovery retry, low-evidence labeled delivery fallback, and repair-loop bypass for evidence absence. |
| 6 — Report hygiene | DONE | `f300130` | 2026-08-12 | Added generated-title / prompt-echo cleanup helpers and wired them into synthesis/save paths so raw prompts no longer become the saved report title/body. |

---

## 8. Findings log (Rule 22)

Out-of-scope issues discovered during execution. Address or schedule —
never dismiss.

| # | Finding | Disposition |
| --- | --- | --- |
| F-1 | `scripts/git/prepare-work-branch.sh` refuses to run when untracked-only files exist in the worktree, reporting "Dirty worktree". Untracked files are safe to carry across `git checkout -b`. | Scheduled — consider `--untracked-files=no` in the dirty check. |
