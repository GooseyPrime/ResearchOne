# Copilot Brief — WO-AD: Sealed Corpus, Silent Retrieval, and the Delivery Path

**Read this first.** Every defect below was observed on the deployed build
`d2c3203` (built `2026-08-18T10:07:26Z`) during two live production runs on
2026-08-21. Nothing here is speculative unless the section says so explicitly.

- `0eee6032-2797-495b-9cef-98212be1cc94` — failed, `contract_failed`, 32m 59s, 547,376 tok
- `243995b4-532f-4086-8bec-ee6b1e84f1b5` — reproduced live, `contract_failed`, 34m 18s, 333,275 tok

Both produced a report with **zero citations** because retrieval returned
**zero chunks** against a corpus of **98,383 embedded chunks**.

**PR #217 does not exist.** The highest PR in `GooseyPrime/ResearchOne` is
#216. Do not look for a #217 regression. #216 is exonerated — see §0.

Rule 41 applies: fix everything you see in the files you touch. Rule 32
applies: do not commit on `main`; branch and open a PR.

---

## Reading order

1. `AGENTS.md` — Rule 41, Rule 32, Rule 40 (corpus gate), Rule 28 (export engine).
2. `.cursor/rules/00-pre-commit-review.mdc` — master checklist.
3. `Work Order X/CURSOR_BRIEF_WO_X.md` — **Phase A step 3 was never done.** See §3.
4. Files to read end-to-end before writing anything:
   - `backend/src/services/retrieval/corpusCompetenceGate.ts` (all)
   - `backend/src/services/retrieval/retrievalService.ts` (lines 85–130, 180–310, 380–440)
   - `backend/src/services/reasoning/researchOrchestrator.ts` (lines 1011–1080, 1329–1470)
   - `backend/src/api/app.ts` (lines 55–100)
   - `frontend/src/components/research/RunSummaryReport.tsx` (lines 45–145)
   - `frontend/src/pages/ReportDetailPage.tsx` (lines 850–910)

---

## §0 — What is NOT the cause (do not re-investigate)

| Hypothesis | Status | Evidence |
|---|---|---|
| PR #216 ingest barrier | **Cleared** | Failed run took the `timeout` path (7/10); live run took the `sufficient` path (8/10, `waitedMs: 76282`). Both reach the same sealed gate and the same 0 chunks. |
| Split-deployment CORS / Socket.IO | **Cleared** | Socket is connected. Duplicate trace entries are its fingerprint — server emits once, client renders twice. No CORS errors, no `localhost` in any request URL. |
| Supabase free-tier hibernation | **Cleared** | `db_size: "2246 MB"`. No 5xx or timeout on any `supabase.co` host. Auth is **Clerk**, not Supabase. |
| BullMQ duplicate job execution | **Cleared** | `progress_events` arrays contain **zero** exact duplicates in both runs (68 and 104 events). No second execution occurred. |
| Stripe webhook signature | **Not tested** | Requires a real charge. Out of scope for WO-AD unless explicitly authorised. |

---

## §1 — [P0] Zero citable chunks must not be a silent success

**File:** `backend/src/services/reasoning/researchOrchestrator.ts` ~line 1388–1400,
and the branch that consumes `corpusGateSealedByDesign`.

### Observed

```
Retrieval 1/5 complete — 0 chunks so far
Retrieval 2/5 complete — 0 chunks so far
Retrieval 3/5 complete — 0 chunks so far
Retrieval 4/5 complete — 0 chunks so far
Retrieval 5/5 complete — 0 chunks so far
```

`retrieval_ids: []` for the whole run. The pipeline then spent 30 more minutes
running specialists, a 184k-token reasoner pass, 24–26 synthesis sections, and
three verifier/contract rounds, before failing at `verification` (93%) with a
**contract** complaint ("did not deliver everything the request asked for") that
never mentions the absence of evidence.

The licence for this is in the code's own comment:

```ts
// Rule 40 seals partitions on purpose while the corpus is still small.
// When every decision is "sealed", zero citable chunks is the DESIGNED
// outcome — not an evidence failure — and must not force degraded delivery.
const corpusGateSealedByDesign = (decisions) =>
  decisions.length > 0 && decisions.every((d) => d.status === 'sealed');
```

There is **no guard anywhere on `allChunks.length === 0`** outside that path.
The only length comparison in the orchestrator is `allChunks.length > 0` at
line 2644, gating `retriever_analysis` — which ran anyway.

### Required change

1. Introduce an explicit **evidence gate** immediately after the retrieval loop,
   before `retriever_analysis` is scheduled. When `allChunks.length === 0`:
   - Emit a first-class progress event at the **retrieval** stage (~20%), not at
     verification. Substep `retrieval_no_evidence`. The message must name the
     reason from `corpusGate.reason` verbatim, e.g.
     `"No citable evidence: discovery.general sealed (self_source_share 0.55 > 0.20)"`.
   - Persist a terminal run status distinguishable from `contract_failed`.
     Add `no_evidence` to the run-status enum and to
     `frontend/src/components/…` status-display rules (the single set of rules
     introduced by PR #214 — do not add a second set).
   - **Halt the run.** Do not proceed to specialists, reasoner, or synthesis.
2. `corpusGateSealedByDesign` must no longer suppress the halt. Distinguish two
   cases explicitly and keep them separate in code and in telemetry:
   - **Bootstrap seal** — the corpus is genuinely too thin
     (`total_chunks < minTotalChunks`, `distinct_sources < minDistinctSources`,
     `global_total_chunks < globalBootstrapMinTotalChunks`). This is the "by
     design" case Rule 40 intended. Still halt, but with a distinct, honest
     message telling the user the corpus needs seeding.
   - **Composition seal** — the corpus is large but fails a *ratio* threshold
     (`self_source_share`, `single_domain_share`, `median_source_age_months`).
     This is **not** by design at 98,383 chunks. Treat it as an evidence failure
     and surface it as such.
3. The existing honest disclosure already rendered in the report header —
   `"No independent sources cleared the corpus gate for this run, so findings
   rest on domain reasoning. Treat specific figures as modeled."` — must be
   emitted **at the retrieval stage**, not only at the end.

### Acceptance

- A run whose corpus gate seals every decision terminates at ≤25% progress.
- Token spend for such a run is under 100k, not 300k+.
- The failure message names the gate reason, not a section-count complaint.
- Unit test: sealed gate on all 5 queries → run status `no_evidence`, no
  synthesis events emitted.

---

## §2 — [P0] `self_source_share` measures the wrong thing and rises with usage

**Files:** `backend/src/services/retrieval/corpusCompetenceGate.ts` (~line 122),
`backend/src/services/retrieval/retrievalService.ts` lines 130, 192, 211, 266, 402.

### Observed

```json
{ "status": "sealed",
  "reason": "self_source_share 0.55 > 0.20",
  "partition": "discovery.general",
  "citableChunks": 0,
  "thresholds": { "maxSelfSourceShare": 0.2 } }
```

The gate counts a source as self-sourced on this condition alone:

```ts
if (record.ownerUserId) { selfSourceCount += 1; }
```

And `ownerUserId` is defined as whoever's ingest job pulled the source:

```sql
COALESCE(ij.user_id, NULLIF(s.metadata->>'ingested_by_user_id', '')) AS owner_user_id
```

So an arXiv preprint or a PubMed Central article fetched by **discovery during a
user's run** is stamped with that user's id and counted as self-referential
evidence. There is a partial exemption for the current run
(`row.discovered_by_run_id === runId ? null : row.owner_user_id`) but sources
from the same user's **previous** runs keep the stamp.

**Consequence:** self-source share is a monotonically increasing function of
product usage. During the live run the corpus went from 595 sources / 96,878
chunks to 601 / 98,383. Every failed run makes the next one more likely to fail.
This is a self-tightening lockout, which is why it presented as a regression
that "appeared after a PR."

### Required change

1. Separate **provenance** from **origin**. `owner_user_id` answers "who was
   logged in when this arrived" and must stop being used as the self-citation
   signal. Introduce an explicit origin classification on `sources` — suggested
   values: `external_discovery`, `user_upload`, `researchone_generated`,
   `user_supplied_url`.
   - Ship a migration that backfills existing rows: anything whose
     `source_type`/URL resolves to an external academic or web domain becomes
     `external_discovery`; anything produced by a ResearchOne report/export
     becomes `researchone_generated`.
2. `selfSourceCount` must count **only** `researchone_generated` — i.e. the
   corpus citing ResearchOne's own prior output, which is what Rule 40 was
   written to prevent.
3. Keep the per-run exemption; it is correct and should remain.
4. `requiresIndependentSources` filtering at `retrievalService.ts:298` uses the
   same `owner_user_id === userId` test and has the same defect — a user's own
   past discovery results get demoted to `backgroundChunks`. Move it onto the
   new origin field. **This is a second, independent path to zero citable
   chunks** and will bite as soon as §1 unseals the gate.

### Acceptance

- Recomputing the gate against the current production corpus yields
  `self_source_share` well under 0.20 for `discovery.general`.
- Test fixture: a partition of 100 external arXiv sources all ingested by one
  user must **not** seal on `self_source_share`.
- Test fixture: a partition of 100 sources of which 55 are
  `researchone_generated` **must** seal.

---

## §3 — [P0] Install pandoc and texlive-xetex — WO-X Phase A step 3 was never done

**Files:** `backend/Dockerfile`, `.github/workflows/deploy-backend-emma.yml`.

### Observed

```
GET https://api.researchone.io/api/reports/exports/engine-status
→ HTTP 200
→ {"available":false,"version":null}
```

Live DOM read of the report page toolbar:

```
{ label: "Export", disabled: true,
  title: "Pandoc is not installed on this server. Contact your administrator." }
```

`grep -rniE "pandoc|texlive|xetex"` across every `Dockerfile*`, `*.yml`, `*.yaml`
and `*.sh` in the repo returns **zero matches**. `Work Order X/CURSOR_BRIEF_WO_X.md`
Phase A step 3 reads:

> **Operational PR** (separate from this Cursor work): add `pandoc` and
> `texlive-xetex` to the production Docker image.

That PR was never opened. The graceful degradation Rule 28 I-6 designed has been
the permanent state of production ever since. PDF, DOCX and HTML export have
never worked; only the separate "Download Markdown" control does.

### Required change

1. Add `pandoc` and `texlive-xetex` (plus `texlive-fonts-recommended` and
   `lmodern` — xelatex fails on missing fonts) to `backend/Dockerfile`.
   Pin versions. Note the image size increase in the PR description.
2. Verify `pandocRunner.ts` finds them on `PATH` in the built image; add a
   build-time smoke step that runs `pandoc --version` and `xelatex --version`.
3. `/api/reports/exports/engine-status` currently returns `{available, version}`
   with **no `detail` field**, so `ReportExportButton` falls back to a hardcoded
   string. Populate `detail` with the actual probe failure so the UI can say
   which binary is missing.

### Acceptance

- `engine-status` returns `{"available":true,"version":"<pandoc version>"}` from
  the deployed image.
- A DOCX and a PDF export of an existing report both download successfully.

---

## §4 — [P0] Retrieval queries are the entire research objective, twelve times over

**File:** the v2 planner that populates `plan.retrieval_queries`; consumed at
`researchOrchestrator.ts` ~line 1397 (`plan.retrieval_queries.slice(0, 5)`).

### Observed

`plan.retrieval_queries` for run `243995b4` contained 12 entries. Their lengths
in characters:

```
16523, 16740, 17004, 16665, 16710, 16556,
16545, 16541, 16551, 16547, 16574, 16802
```

`run.query.length` is 16,523. Each "retrieval query" is the **whole objective**
plus a short distinguishing suffix. All twelve begin with the identical 90
characters. Only the first five are used, and they are effectively one query
repeated.

This is currently invisible because §1's seal short-circuits before
`generateEmbeddings` is reached:

```ts
if (corpusGate.status === 'sealed') {
  return { citableChunks: [], backgroundChunks: [], corpusGate };
}
// ─── Semantic vector search ──────────  ← never reached
const vectors = await generateEmbeddings([queryText]);
```

**Fixing §1 and §2 without fixing this yields zero chunks for a different
reason.** A 16 KB string overruns every embedding model's context window, and
the hybrid search's keyword arm receives a 16 KB "keyword."

### Required change

1. The planner must emit **short, distinct, targeted** retrieval queries.
   Enforce a hard cap in the orchestrator regardless of what the planner
   returns — reject or truncate any query over a configured
   `maxRetrievalQueryChars` (suggest 512) and log a warning naming the planner
   role that produced it.
2. Enforce **distinctness**: reject a query set whose entries share a common
   prefix beyond a small threshold, and fall back to deterministic query
   generation from `plan.sub_questions` when they do.
3. Add a validation step at plan-confirmation time so the problem surfaces at
   the gate the user actually sees, not silently at retrieval.
4. `summarizeCorpusGateDecisions` currently persists the full 16 KB query text
   into `research_runs.corpus_after` **once per decision**. Store a hash or a
   truncated label instead.

### Acceptance

- No retrieval query exceeds 512 characters.
- No two retrieval queries in a set share more than 64 leading characters.
- `corpus_after.corpusGate` is under 4 KB for a typical run.

---

## §5 — [P1] The app's own polling exceeds its rate-limit headroom

**Files:** `backend/src/api/app.ts` lines 73–79; the polling hooks in
`frontend/src/pages/ResearchDeepPage.tsx`; `backend/src/api/routes/research.ts`
(list endpoint payload).

### Observed

Measured over 12.1 minutes on the live run, counting **only** the app's own XHR
calls with one tab open and one run in flight:

| Endpoint | Calls |
|---|---|
| `/api/research/{id}` | 108 |
| `/api/research` (list) | 97 |
| `/api/health` | 31 |
| `/api/corpus/stats` | 31 |
| `/api/notifications` | 13 |
| **total** | **289 → 23.8/min → 357 per 15 min** |

The limiter is `windowMs: 15 * 60 * 1000, max: 500`. One user, one tab, one run
consumes **71%** of the global allowance. A second tab, a mid-run refresh, or a
second concurrent viewer exhausts it.

When it tips, the 429 body is **plain text** (`Too many requests, please try
again later.`), the client calls `.json()` on it, and throws
`SyntaxError: Unexpected token 'T'`. Observed consequences: the status pill
flipped to "System unreachable" and the Recent Runs list showed 50% while the
live trace showed 88% — both false, the run was healthy.

### Required change

1. `/api/research` (list) returns every run's **complete** `query` text —
   16 KB per run — and is polled ~8×/min. Return a truncated `title` only.
   Add a separate detail endpoint for full query text.
2. Socket.IO is connected and working (see §6). The REST poll should be a
   **fallback**, not a parallel channel: back off the run-detail poll to a long
   interval (≥30s) whenever the socket is connected, and only fall back to fast
   polling on socket disconnect.
3. Stop polling `/api/health` and `/api/corpus/stats` every ~23s. Health belongs
   on a much longer interval; corpus stats can update on run completion.
4. Return **JSON** from the rate limiter (`express-rate-limit`'s `message`
   option accepts an object — the `authLimiter` above already does this
   correctly; `defaultLimiter` does not) and honour `Retry-After` in the client.
5. Add a client-side guard: any non-2xx response must not reach `.json()`
   unguarded.

### Acceptance

- One tab watching one run stays under 150 requests per 15 minutes.
- A forced 429 leaves the UI showing a clear "rate limited, retrying" state, not
  a frozen progress panel.

---

## §6 — [P1] The live trace renders every event twice

**Files:** `frontend/src/pages/ResearchDeepPage.tsx` lines 483–656; whatever
appends REST-polled events to the same array.

### Observed

Server-side `progress_events` arrays are **clean**:

```
run 243995b4   68 events, 0 exact duplicates, 18 section_generated for 18 sections
run 0eee6032  104 events, 0 exact duplicates
```

The UI shows each event twice, with byte-identical timestamps:

```
12:53:21  synthesis 80%  Report section 2/24: 2. Zero-Cost Affiliate Comparison Site Opportunities
12:53:21  synthesis 80%  Report section 2/24: 2. Zero-Cost Affiliate Comparison Site Opportunities
```

The event arrives once over Socket.IO and once from the REST poll, and both are
appended. The only genuine server-side redundancy is two `done` events 10 ms
apart with different wording (`"finished with status"` / `"finished with gate
status"`) — collapse those to one.

### Required change

1. Dedupe on ingest by a stable key — `(runId, timestamp, stage, substep)` —
   before appending to the trace array. Do this in one place, not per-handler.
2. Collapse the duplicate `done` emission in the orchestrator.
3. The report page toolbar renders **twice** in the DOM (two Print, two Share,
   two Download Markdown, two Export, two Featured Report buttons). Find and
   remove the duplicate mount in `ReportDetailPage.tsx`.

---

## §7 — [P1] Phase timings are wrong along two independent paths

**Files:** `backend/src/services/reasoning/researchOrchestrator.ts` lines
1011–1035; `frontend/src/components/research/RunSummaryReport.tsx` lines 50–70.

### Observed

The two downloaded Run Summary files disagree with each other about equivalent
runs, and neither matches the trace:

| Phase | Server path | Client path | True span from trace |
|---|---|---|---|
| discovery | **14 ms** | 2m 15s | ~3m 43s |
| retrieval | **56 ms** | 6.0 s | ~13 s |
| epistemic_persistence | **2m 22s** | **0 ms** | 71.081 s |

**Server path.** `progress()` resets `phaseStartTimes[stage] = now` on *every*
call, not only on re-entry. A stage therefore accumulates only the gap between
its **last** event and the first event of the next stage. Verify: retrieval's
last event is `05:00:11.101`, `retriever_analysis` starts `05:00:11.157` —
difference 56 ms, exactly the reported figure.

**Client path.** `derivePhaseTimings` takes min/max of each stage's event
timestamps, so any stage with a single event reports `0 ms`.

### Required change

1. Track phase boundaries explicitly: record `phaseStart` once when a stage is
   **entered** (`currentStage !== stage`), not on every call. Preserve the
   resume/retry intent by accumulating across re-entries rather than resetting.
2. Make the server the single source of truth for `phaseDurations` and remove
   the divergent client fallback, or make the client derive boundaries the same
   way (stage entry → next stage entry) rather than min/max.
3. **Unexplained, investigate:** `epistemic_persistence` reports 2m 22s against
   a true span of 71.081 s — exactly 2×. Neither known mechanism produces that.
   Do not paper over it; find it.

---

## §8 — [P1] Discovery relevance

**File:** the discovery ranking path feeding `discovery_summary.sources`.

### Observed

Top-ranked source for a study on affiliate comparison-site market verticals:

```json
{ "url": "https://arxiv.org/pdf/2109.09554v1",
  "rank": 1, "score": 1,
  "title": "Spin Wave Based Approximate 4:2 Compressor" }
```

Spin-wave majority gates, rank 1, score 1.0. Preceded by a silent planner
failure: `"Discovery planner returned no usable queries; recovered with 4
deterministic queries"` (substep `discovery_deterministic_fallback`).

### Required change

1. A `score: 1` at `rank: 1` for an unrelated document means the relevance
   signal is either absent or defaulted. Find where the score is assigned and
   make an unscored source score `null`, not `1`.
2. `discovery_deterministic_fallback` must be surfaced to the user as a
   degradation, not logged and forgotten — the deterministic queries are almost
   certainly what produced the irrelevant results.
3. Likely shares a root cause with §4: if the deterministic fallback also builds
   queries from the raw objective, fix both together.

---

## §9A — [P0] The synthesizer emits unreadable sections — this is a generation defect, not CSS

**Files:** `backend/src/services/reasoning/reportGenerator.ts`
(`generateIterativeReport`, lines ~909 and ~972);
`backend/src/services/openrouter/openrouterService.ts` lines 927–962 (the role
system prompts); the contract auditor's `revision[]` producer at
`researchOrchestrator.ts` lines ~745–770; the repair pass at `verification`.

The owner's complaint — *"look at section 3, 6, 7, 11, 14 … how can anyone even
read these"* — is **not** the table-width issue in §9B. It is five generation
bugs in the delivered Markdown of run `243995b4`.

### Which agent is responsible

`generateIterativeReport` calls four roles. Responsibility splits cleanly:

| Role | Called at | Owns | Guilty of |
|---|---|---|---|
| `outline_architect` | `reportGenerator.ts:909` | section titles, order, count | 9A.5 — generic and duplicated headings, out-of-order emission, missing per-item heading level |
| `section_drafter` | `reportGenerator.ts:972` | each section's body | 9A.1 pseudo-tables · 9A.2 placeholder stubs · 9A.3 portfolio bleed |
| `internal_challenger` | `reportGenerator.ts:1096` | critique pass | **skipped** — `skipChallenger: !isAdjudicative`, so it never ran |
| `coherence_refiner` | `reportGenerator.ts:1114` | whole-report integration | did not catch any of the above |

**The prompts are the problem, and they are short.** `outline_architect` is
three lines total:

```
You are the Outline Architect.
Produce a structured report outline and section order for the current query and evidence context.
Output strict JSON: { "outline": [{"title": "...", "key": "...", "objective": "..."}] }
```

No uniqueness constraint, no requirement that a title name its subject, no
ordering guarantee. That is the whole reason five sections are called
"Opportunity."

`section_drafter` has eight detailed WRITING RULES — and every one of them is
about *emphasis*. Three separate rules ban `**bold**` and `*italic*`. **Not one
rule says how to render a table.** It says only "Use tables, ranked lists,
cards, numbered procedures, or concise paragraphs as appropriate for the
intent," which is what produced middle-dot prose instead of Markdown.

Note also: the run summary's MODEL USAGE table lists `coherence_refiner` but
**neither `outline_architect` nor `section_drafter`** — the roles that write the
report are missing from the telemetry. Fix that while you are here.

### 9A.1 — Tables emitted as middle-dot run-on lines

Sections 3, 6, 7, 11 and 14 contain no Markdown table at all. They contain the
table flattened into `·`-separated paragraph lines:

```
## 6. Opportunity

Rank · Vertical · Example products/services · Primary monetization model · Representative
affiliate programs · Typical commission economics · Recurring commission potential · …
1 · AI Development Tools · LLM APIs, vector databases, AI frameworks · Percentage-of-sale
(unverified estimate) · Anthropic Partner Program (unverified program availability) · …
```

**Cause:** the user's objective specifies the required columns using `·` as the
separator (`Rank · Vertical · Example products/services · …`). The synthesizer
copied the prompt's punctuation instead of emitting a pipe table. No renderer
can fix this — there is no table in the source.

**Fix:** the section synthesizer must emit GFM pipe tables. Add a post-generation
validator: any section containing ≥3 lines with ≥5 middle-dot separators is a
malformed table — reject and regenerate with an explicit pipe-table instruction.
Do not feed the requested-columns spec to the model in `·` form.

### 9A.2 — Placeholder stubs shipped in the delivered report

Both section 6 and section 14 list verticals 1–5 and then literally print:

```
[Verticals 6-20 follow identical structure with decreasing scores from 79 to 51 and
 uniformly "Low" confidence]
```

(Section 14 says `from 79 to 43`.) A bracketed "and the rest are similar" note is
a draft artifact. **Fix:** add a contract check that fails any section containing
a bracketed continuation placeholder (`[… follow …]`, `[etc.]`, `[remaining …]`)
and route it to the repair pass.

### 9A.3 — Every "opportunity" section re-emits the whole 20-vertical portfolio

Sections 6 and 14 are each supposed to cover **one** market vertical. Both
instead restate the entire ranked portfolio — with *different* contents:
section 6 ranks "AI Development Tools / Developer Infrastructure /
Cybersecurity Software …", section 14 ranks "Developer Tool Comparisons /
Open-Source Alternative Comparisons / Business SaaS Stack Comparisons …". Both
close with a **byte-identical** paragraph beginning *"The framework prioritizes
verticals where the operator's technical capabilities could theoretically…"*.

**Fix:** the per-item synthesizer is receiving the portfolio-level instruction
instead of the single-item instruction. Bind each section prompt to exactly one
outline node and assert in code that a generated section does not contain a
ranked list of other items.

### 9A.4 — Contract-repair instructions leak in as section headings

The delivered report contains these as literal `##` headings:

```
## Requested table is absent. A pipe-delimited markdown table
## Exactly 20 market verticals
## Single, definitive Master Portfolio Table ranking all 20 opportunities
```

These are the auditor's `revision[]` strings — the same shape as
`revision.push(\`Deliver exactly ${requestedCount} opportunity objects with
consistent ranking and headings.\`)`. The repair pass is using the revision
instruction **as the new section's heading**.

**Fix:** the repair pass must carry the revision instruction as *prompt context*,
never as heading text. Add a guard rejecting any generated heading that matches a
known revision string or begins with an imperative ("Requested", "Provide",
"Include", "Deliver", "Generate", "Exactly", "Single").

### 9A.5 — Generic and duplicated headings

Of 20 supposedly distinct verticals, the delivered headings are:

```
6. Opportunity      8. Opportunity      12. Opportunity
14. Opportunity    18. Opportunity
4. AI-Powered SaaS Comparison Platforms      5. AI-Powered SaaS Comparison Platforms
9. AI-Powered SaaS Comparison Platforms     17. AI-Powered SaaS Comparison Platforms
2. / 11. / 19. Zero-Cost Affiliate Comparison Site Opportunities
```

Five sections are titled the bare word **"Opportunity"**. One title is reused
four times. `## Overview` appears twice (lines 339 and 344), the first with no
body. Sections are also emitted out of order (observed: 1, 4, 5, 6, 7, 3, 2, 10,
12, 13, 11, 14, 8 …).

**Fix:** reject a heading that is a bare generic noun; require each item heading
to name its vertical; enforce uniqueness across the outline; emit in outline
order.

### 9A.6 — Item blocks with no item names

The section headed `## Exactly 20 market verticals` is twenty consecutive
repetitions of:

```
#### Narrative Briefing
#### Basic Project Needs
#### Build Prompt
#### Test Prompt
#### Deployment Prompt
```

with **no heading naming which vertical each block describes**. The reader gets
sixty identical `####` headings in a row and must infer from the prose that
block 1 is cloud cost optimization, block 2 is open-source alternatives, block 3
is no-code platforms. The objective asked for "Inside **every item**, use these
exact Markdown headings" — the item level itself was dropped.

**Fix:** the outline node for a multi-item section must carry the item list, and
each item must be emitted as a `###` heading naming the vertical, with the five
`####` sub-headings nested under it. Add a structural check: a section
containing repeated identical `####` headings must have a distinct `###` ancestor
between each repetition.

### 9A.7 — Prompt changes to make

Apply to `backend/src/services/openrouter/openrouterService.ts`. Both roles have
a second definition later in the file (`withStandardPreamble`, ~line 1281) —
**update both copies.**

**`outline_architect`** — add:

```
- Every title must name its specific subject. Never emit a bare generic noun
  ("Opportunity", "Analysis", "Overview") as a title.
- Titles must be unique across the outline. If two sections would cover the same
  subject, merge them or differentiate the subject.
- Emit sections in the order they should be read. The consumer renders them in
  array order and does not sort.
- When a section contains a numbered set of items, include the item list on the
  outline node so each item can be drafted and headed individually.
```

**`section_drafter`** — add a TABLE AND STRUCTURE RULES block. The existing
WRITING RULES are entirely about emphasis and say nothing about layout:

```
TABLE AND STRUCTURE RULES:
- Render every table as a GitHub-Flavored Markdown pipe table with a header row
  and a separator row. Never separate columns with middle dots, bullets, tabs,
  or any other character, even when the request specifies columns in that form.
- Never emit a continuation placeholder. Bracketed notes such as
  "[items 6-20 follow the same structure]" are draft artifacts, not deliverable
  content. Emit every row, or state plainly that the data is unavailable.
- Draft ONLY the section you were given. Do not restate the report's overall
  ranking, portfolio, or item list inside an individual item's section.
- Do not repeat a closing paragraph you have used in another section.
- Keep tables to at most 8 columns. If the contract requests more, split into
  two tables joined by the identifier column, and say which is which.
- Every item in a multi-item section gets its own heading naming that item,
  above any sub-headings.
```

**Consider un-skipping `internal_challenger`.** It is disabled for every
non-adjudicative intent (`skipChallenger: !isAdjudicative`), which is exactly the
class of report — opportunity_discovery — that shipped these defects. A cheap
structural-only pass would have caught all five.

### Acceptance for §9A

- No `·`-separated pseudo-table in any generated section.
- No bracketed continuation placeholder in a delivered report.
- Every one of N item sections covers exactly one item and contains no ranking of
  other items.
- No heading matches a revision instruction or begins with an imperative verb.
- All N item headings are distinct and none is a bare generic noun.
- No section contains repeated identical `####` headings without a distinct
  `###` item heading between them.
- No table exceeds 8 columns.
- `outline_architect` and `section_drafter` both appear in the run summary's
  MODEL USAGE table.

---

## §9B — [P2] Report presentation and print

**Files:** `frontend/src/components/reports/ReportMarkdown.tsx`,
`frontend/src/components/dossiers/SkepticAnnotationsAside.tsx`,
`frontend/src/index.css` (or equivalent global stylesheet).

### Observed

Measured on the live report page at a 1833 px viewport:

| Table | Columns | Table width | Container | Visible |
|---|---|---|---|---|
| Master portfolio | 18 | 2536 px | 598 px | 24% |
| Scoring model | 4 | 596 px | 598 px | 100% |
| Cross-opportunity | 24 | 3213 px | 598 px | 19% |

### Required change

1. **The Markdown is valid GFM** — every table has its separator row — and
   `ReportDetailPage.tsx:904` and `ReportMarkdown.tsx:151` both pass
   `remarkGfm`, so those surfaces render real `<table>` elements. But
   `SkepticAnnotationsAside.tsx` renders `<ReactMarkdown>` with **no plugins**,
   and `ReportMarkdown.tsx:16` documents a prior instance of exactly this bug in
   `DossierReportSection`. **Audit every `ReactMarkdown` mount in the codebase
   and route them all through the single `ReportMarkdown` component.** No
   component may instantiate `ReactMarkdown` directly.
2. The report content column is capped at 598 px on an 1833 px viewport. Let
   wide tables break out of the prose column, or give them a full-width
   presentation mode. A 24-column table in a 598 px slot is unusable.
3. **There is no `@media print` rule anywhere in the frontend.** Add a print
   stylesheet: hide nav, sidebar and toolbars; set the content column to full
   width; allow tables to break across pages (`break-inside: auto` on rows).
4. Constrain the synthesizer: a 24-column table is a generation defect as much
   as a rendering one. Cap generated table width and split wide tables.
5. Duplicate `## Overview` heading in generated output — dedupe section headings
   at synthesis, and fix the out-of-order section numbering (observed: sections
   emitted 1, 4, 5, 6, 7, 3, 2, 10, 12, 13, 11, 14, 8 … with repeated titles).

---

## §10 — [P2] Signed-in users are shown the signed-out header

**File:** the marketing-site header component.

### Observed

With `window.Clerk.user` populated (`brandon@intellmeai.com`) and
`POST /api/auth/sync` returning 200:

```
ResearchOne | ONLINE | Methodology | Sample Report | Pricing | Security | Sign In | Start Research
```

`Start Research` — the primary CTA — resolves to `href="/sign-up"`.

### Required change

Gate the header on Clerk session state. Signed-in users see an account control
and a `Start Research` link that resolves to `/app/research`.

---

## §11 — [P2] Stage count mismatch between marketing and product

The landing page pipeline graphic names nine stages (Planner, Sleuth, Retriever,
Quant, Reasoner, Skeptic, Drafting, Verifier, Formatter). The in-app governance
panel names seven (Planning, Discovery, Retrieval, Reasoning, Challenge,
Synthesis, Verification).

Skeptic was skipped in both runs (`"Skeptic skipped for this intent profile"`),
as was the plain-language pass. Reconcile the two, and make a skipped stage
visible as a skipped stage in the UI rather than a stage that silently never
appears.

---

## §12 — [P2] Clerk development instance in production

```
publishable key: pk_test_bWVldC1sYWNld2luZy0xNS5jbGVyay5hY2NvdW50cy5kZXYk
  base64 decodes to: meet-lacewing-15.clerk.accounts.dev$
```

`pk_test_` plus a `.clerk.accounts.dev` host is a Clerk **development** instance:
capped user count, dev-signed session tokens, no production guarantees.

**This is an operational change, not a code change** — provision a Clerk
production instance, move `VITE_CLERK_PUBLISHABLE_KEY` and the backend secret to
production values, redeploy. Add a startup assertion alongside the existing
`assertSplitDeploymentEnv` in `frontend/src/config/splitDeployment.ts` that
throws in `PROD` when the publishable key starts with `pk_test_`.

Also correct the internal stack documentation: **auth is Clerk, not Supabase.**

---

## §13 — [P0, owner-requested] Hide the Featured Report control from non-admins

**The backend is already correct. The frontend is not.** Keep the feature for
admins; make it invisible and unreachable for everyone else.

### Already correct — do not change

`backend/src/api/routes/reports.ts:176`:

```ts
router.post('/:id/publish-featured', requireAdmin, async (req, res, next) => {
```

`requireAdmin` (`backend/src/middleware/clerkAuth.ts:69`) checks
`config.admin.userIds.includes(req.auth.userId)` and returns 403 otherwise. A
standard user already cannot publish.

### The defect

`frontend/src/pages/ReportDetailPage.tsx` renders the control unconditionally
for **every** user, and renders it **twice** — `onFeatured` is passed at both
line 380 and line 737 (this is the duplicate toolbar from §6):

```tsx
<button type="button" className="btn-ghost p-2 h-9 w-9 disabled:opacity-50"
        title="Publish as Featured Report (thenewontology.life)"
        onClick={onFeatured} disabled={featuredPending}>
  <Globe size={16} />
</button>
```

Two consequences, the second being the one the owner cares about:

1. A standard user clicking it gets a 403.
2. **The tooltip leaks the association between ResearchOne and
   thenewontology.life to every single user.** No standard user should be able
   to connect the two properties at all.

### Required change

1. Gate the control on admin status. `GET /api/auth/...`
   (`backend/src/api/routes/auth.ts:27–28`) already returns
   `{ userId, isAdmin }` — use it. When `isAdmin` is false the button must not
   be **rendered at all** — not hidden with CSS, not disabled. The string
   `thenewontology.life` must never reach a non-admin's DOM.
2. Audit the shipped frontend bundle: `grep` the built assets for
   `thenewontology` and confirm it does not appear in any chunk a non-admin
   loads. If it does, move the string behind an admin-only lazy-loaded chunk or
   fetch it from the admin API rather than hardcoding it.
3. Remove the duplicate toolbar mount (§6.3) so the control exists once.
4. Confirm `brandon@intellmeai.com`'s Clerk user id is present in
   `config.admin.userIds` in the production environment. If admin identity
   should be email-based rather than id-based, say so — currently it is id-based
   and the env var must be kept in sync by hand.
5. Leave `backend/src/services/featuredReportGithub.ts`, the route, and the
   `config/index.ts` block **in place**. Do not delete them.

---

## §14 — [P1] Stripe: a fallback that re-serializes the webhook body, and an untested ledger path

**File:** `backend/src/api/webhooks/stripe.ts` line ~317.

### The middleware ordering is correct — do not "fix" it

`backend/src/api/app.ts` lines 49–58 mount `express.raw({ type: 'application/json' })`
on `/api/webhooks/stripe` and `/webhooks/stripe` **before** the global
`express.json()`. The classic class-1 bug (JSON-parsed body reaching
`constructEvent`) is not present today.

### The defect: a fallback that silently reintroduces it

```ts
const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
```

The second branch re-serializes an already-parsed body. `JSON.stringify` will
not reproduce Stripe's original bytes — key order, whitespace and unicode
escaping all differ — so `constructEvent` fails and every webhook 400s.

It fails closed, which is safe, but it is a trap: any future change to middleware
order or route mounting flips the ternary silently, and the symptom (all Stripe
webhooks returning `Invalid signature`) looks like a secret-rotation problem
rather than a body-parser problem.

### Fix 14.1 — replace the fallback with a loud failure

Delete the fallback. If `req.body` is not a Buffer, that is a server
misconfiguration, and the error should name itself. Apply exactly this:

```ts
    // The raw body is REQUIRED for signature verification. `express.raw()` is
    // mounted on both `/api/webhooks/stripe` and `/webhooks/stripe` ahead of the
    // global `express.json()` (see `api/app.ts`). If a Buffer does not arrive
    // here, that ordering has been broken.
    //
    // Do NOT fall back to `Buffer.from(JSON.stringify(req.body))`. Re-serializing
    // a parsed body cannot reproduce Stripe's original bytes — key order,
    // whitespace and unicode escaping all differ — so `constructEvent` would
    // reject every event with `Invalid signature`, which reads as a rotated
    // secret rather than a middleware misconfiguration. Fail loudly instead.
    if (!Buffer.isBuffer(req.body)) {
      logger.error('stripe_webhook_raw_body_missing', {
        path: req.originalUrl,
        bodyType: typeof req.body,
      });
      res.status(500).json({ error: 'Webhook raw body parser not mounted' });
      return;
    }
    const rawBody = req.body;
```

Add a regression test asserting `express.raw` precedes `express.json()` for both
Stripe mount paths, and a test asserting a non-Buffer body yields 500 with
`stripe_webhook_raw_body_missing` — never a 400 signature error.

### Fix 14.2 — document what is actually being sold

Three different products settle through three different event shapes, and
conflating them is how a payment "succeeds" while a balance never moves. Insert
this block immediately above `const STRIPE_EVENT_HANDLERS` in
`backend/src/api/webhooks/stripe.ts`:

```ts
/**
 * Event routing, by what the customer actually bought.
 *
 * ResearchOne sells three distinct things through Stripe, and they settle
 * through different events. Mixing them up is how a payment "succeeds" while a
 * balance never moves.
 *
 * 1. RECURRING SUBSCRIPTIONS (Checkout `mode: 'subscription'`)
 *    What it buys: a tier, whose entitlements are evaluated live on every
 *    request. There is no balance to increment — the tier IS the entitlement.
 *    Settles through: `checkout.session.completed` (initial),
 *    `customer.subscription.created|updated|deleted` (lifecycle),
 *    `invoice.payment_succeeded|failed` (renewal health).
 *    Ongoing obligation: active status must be MONITORED. A subscription can
 *    lapse without any user action (card expiry, dispute, dunning), so the tier
 *    must be revoked on `deleted` and flagged on `payment_failed`.
 *    NOTE ON 100%-OFF COUPONS: a fully discounted subscription produces a $0
 *    invoice with NO PaymentIntent and NO charge. `checkout.session.completed`
 *    still fires and tier sync still works, but any handler keyed on a non-null
 *    `payment_intent` will not run. A coupon-only test therefore proves tier
 *    sync and proves NOTHING about the paths in (2) and (3).
 *
 * 2. WALLET TOP-UPS (Checkout `mode: 'payment'`, wallet checkout_kind)
 *    What it buys: prepaid credit, held as a ledger balance and DEBITED
 *    INTERNALLY as the user consumes paid features — run add-ons such as
 *    Devil's Advocate Review, Parallel Search, Parallel Extract and Smart
 *    Citations, and any per-run surcharge their tier does not already cover.
 *    Settles through: `checkout.session.completed` only, via
 *    `creditWalletFromCheckoutSession`.
 *    Ongoing obligation: none from Stripe. Once credited, the balance is ours
 *    to debit. Correctness therefore rests entirely on the credit landing
 *    exactly once — hence the idempotency guard in `dispatchWebhookEvent`.
 *
 * 3. MONITOR TOKEN PACKAGES (Checkout `mode: 'payment'`, token package)
 *    What it buys: a countable quantity of monitor tokens, credited like (2)
 *    but drawn down by monitor scheduling rather than by run add-ons.
 *    Settles through: `checkout.session.completed` via
 *    `creditMonitorTokensFromCheckoutSession`.
 *
 * The practical consequence: (1) is verified by watching subscription state
 * over time; (2) and (3) are verified by asserting the ledger moved by the
 * expected amount exactly once. Testing (1) does not test (2) or (3).
 */
```

### Fix 14.3 — test the paths the coupon never touches

The owner reports subscriptions "seem to work," tested with a **100%-off
coupon**. That exercises `checkout.session.completed` with
`mode: 'subscription'` and tier sync — which do work. It exercises **none** of
the ledger path, for the reasons in 14.2.

Required tests:

1. **Wallet top-up, Stripe test mode, real test card.** `mode: 'payment'` →
   assert the ledger increments by the expected amount, exactly once, and the
   balance survives a page refresh (the "reverts on refresh" symptom in the
   original class-1 report).
2. **Replay the same event id.** Assert the ledger does not double-credit.
3. **$0 coupon subscription.** Assert tier sync completes and that no
   ledger-crediting handler fires — pin the current behaviour so the coupon
   shape is tested rather than accidental.
4. **Subscription lapse.** `customer.subscription.deleted` → tier revoked;
   `invoice.payment_failed` → flagged, not silently retained.
5. **Debit side.** Selecting a paid add-on on a run debits the wallet by the
   listed amount and refuses the run when the balance is insufficient.

### Fix 14.4 — verify what production is actually configured for

Confirm `STRIPE_WEBHOOK_SECRET` on the Emma VM matches the endpoint secret of
the *live* webhook endpoint in the Stripe dashboard, and that the dashboard
endpoint subscribes to all six events in `STRIPE_EVENT_HANDLERS`. A missing
subscription for `checkout.session.completed` produces exactly the reported
symptom with no error anywhere. Report the configured event list in the PR
description.

---

## §15 — [P1] `outline_architect` and `section_drafter` are active but invisible to the run summary

**File:** `backend/src/services/reasoning/reportGenerator.ts` (the return of
`generateIterativeReport`, ~line 1160); `researchOrchestrator.ts` line 963 and
its ~18 `modelLog.push(...)` call sites.

### The question, answered

Both roles **are active**. They ran, they drafted 24 sections, and they are not
merged into another role, not removed, and not gated off by the planner or the
intent profile — `shouldRunPipelineStage(orchProfile, 'synthesis')` was true for
this run.

The gap is a **return-value gap in telemetry plumbing**, and it is narrow:

1. `modelLog` is a plain local array declared at `researchOrchestrator.ts:963`.
   It is populated *only* where the orchestrator explicitly calls
   `modelLog.push(...)`. It is written to `research_runs.model_log`, which is
   what the Run Summary's MODEL USAGE table renders.
2. `generateIterativeReport` makes four internal `callRoleModel` calls —
   `outline_architect` (`reportGenerator.ts:909`), `section_drafter` in a loop
   (`:972`), `internal_challenger` (`:1096`), `coherence_refiner` (`:1114`) —
   and returns:

   ```ts
   return { markdown, sections, outline, targetWordCount, plannedItemTitles, refinedSectionCount };
   ```

   **No `ModelCallResult` is returned.** All four roles' telemetry is discarded
   at the function boundary.
3. The orchestrator therefore has nothing to push. The `else` branch — the
   minimal-synthesis path — *does* push (`modelLog.push(refSynth)` at :2034),
   which is why light runs look complete and full runs do not.

### Why `coherence_refiner` appears anyway, three times

Those rows are **not** the synthesis-time refiner. They are the repair-loop
invocations at `researchOrchestrator.ts:2353`, which the orchestrator calls
directly and pushes itself. That is exactly why they interleave with `verifier`
and `contract_auditor` three times in the failed run's summary.

### What is NOT wrong

Cost telemetry is fine. `emitCallTelemetry` is called inside `callRoleModel`
itself (`openrouterService.ts:602` and `:643`), so every role — including these
two — is recorded, and `rolePhaseFor` (`costSidecar.ts:104`) already maps
`outline_architect`, `section_drafter` and `coherence_refiner` to the
`Synthesis` phase. The cost sidecar knows about this work. Only `model_log`,
and therefore the user-facing summary, does not.

### Why it matters more than a missing table row

Synthesis was the **largest phase of the run** — 14m 39s and 24 section drafts —
and it is entirely absent from the summary's `304,344 prompt + 28,931 completion
= 333,275 total`. The number shown to the user materially understates the run.
For a product with a credit ledger and per-run add-on surcharges (§14), a
user-facing cost figure that omits the biggest cost centre is a billing-trust
problem, not a cosmetic one.

### Required change

1. Return the model calls from `generateIterativeReport`:
   `modelCalls: ModelCallResult[]` accumulating the outline call, every section
   call, the challenger call (or its `skipped-by-profile` stub), and the refiner
   call — the same shape `specialistExecution.modelCalls` already uses.
2. In the orchestrator, `modelLog.push(...iterativeReport.modelCalls)` alongside
   `plannedItemTitles`, mirroring line 1604.
3. Reconcile: assert in a test that the sum of `model_log` prompt+completion
   tokens equals the sum of the run's `agent_executions` rows. They currently
   diverge by the whole synthesis phase, and nothing catches it.
4. Separately, decide about `internal_challenger`. It is skipped for every
   non-adjudicative intent (`skipChallenger: !isAdjudicative`). Whichever way you
   go, it should appear in the summary as an explicit *skipped* row rather than
   being absent — a role that silently vanishes is indistinguishable from a role
   that failed. See §11.

---

## Write order

Land in this order; each phase is independently shippable.

**Phase 1 — stop the bleeding (P0, one PR)**
§1 evidence gate · §13 admin-gate the Featured Report control

**Phase 2 — unseal (P0, one PR)**
§2 origin classification + migration + backfill · §4 retrieval query caps

**Phase 3 — readable output (P0, one PR)**
§9A synthesizer defects — pseudo-tables, placeholder stubs, portfolio bleed,
revision-instructions-as-headings, generic headings

**Phase 4 — delivery (P0, operational + code)**
§3 pandoc/texlive in the image · §5 rate-limit and payload fixes

**Phase 5 — billing correctness (P1, one PR)**
§14 Stripe raw-body guard · payment-type documentation · wallet-ledger and
subscription-lapse tests · webhook endpoint config audit

**Phase 6 — truth in the UI (P1)**
§6 trace dedup · §7 phase timings · §8 discovery relevance · §15 synthesis-role
telemetry

**Phase 7 — presentation and hygiene (P2)**
§9B rendering and print · §10 header · §11 stage reconciliation · §12 Clerk

---

## Definition of done for WO-AD

1. A run against a sealed corpus halts at ≤25% with an honest, specific message
   and under 100k tokens spent.
2. A run against an unsealed corpus returns non-zero citable chunks and the
   delivered report contains real citations with resolvable URLs or DOIs.
3. `engine-status` reports `available: true`; DOCX and PDF export both download.
4. One tab watching one run stays under 150 API requests per 15 minutes.
5. The live trace shows each event exactly once.
6. Phase timings in the Run Summary match the event trace within 5%.
7. No `ReactMarkdown` is instantiated outside `ReportMarkdown`.
8. Printing a report produces the report, without nav chrome, across all pages.
9. Every item section covers one item, in outline order, with a distinct
   non-generic heading, a real pipe table, and no bracketed placeholder.
10. `thenewontology.life` appears nowhere in the DOM or bundle a non-admin loads.
11. The Stripe raw-body fallback is gone, and a test-mode `mode: 'payment'`
    top-up demonstrably increments the credit ledger.
12. Full suite green. Lint and format clean. Rule 32 respected — PR, not a
    direct push to `main`.
