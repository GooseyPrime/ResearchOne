# ResearchOne — mandatory work queue

Standing document. Nothing here is optional and nothing here is closed by a
session ending. Every item names its evidence, its acceptance test, and who
decides. Update the status column; do not delete rows.

Maintained because a single session cannot finish this list, and the last three
sessions each optimised something the operator did not ask for while the report
— the product — got worse.

---

## The ordering rule

**Report quality outranks everything.** A run that produces a badly-numbered,
table-less report citing an Enterobacteriaceae identification paper in a market
analysis is not improved by a nicer run page, a cleaner form, or better
vocabulary. If a session has time for exactly one thing, it is the report.

Anything below Priority 2 is deferred by default, not by permission.

---

## P0 — the report is wrong (WO-AI)

Evidence: operator test run, 2026-08-25. Every item below is an observed defect
in a real report, not a theory.

| # | Observed | Cause found | Status |
|---|---|---|---|
| AI-1 | Section headings read `16.16`, `18.18` | The drafter numbers its own `ITEM NAME` because the plan it can see is numbered; the assembler numbers it again. A heading written into a body was also never stripped. | **Done** |
| AI-2 | Content that should be a table is run-on prose | The drafter was told to emit a table by the requested FORMAT; the auditor read only the brief. Instruct-and-do-not-check. (`\btable\b` also never matched `comparison_table` — `_` is a word character.) | **Done** |
| AI-3 | The opportunities table shows 13 rows, then continues as delimited text | Every check looked at the table that parsed, so a table missing seven rows passed a row count that counted the fragment. `table_truncated` now fails the contract. | **Done** |
| AI-4 | 9 sources for a long, detail-heavy report | `MAX_EXTERNAL_INGEST_PER_RUN` defaults to 10, flat, for every run. Not a retrieval-yield problem. The budget scales with the deliverable now. | **Done** |
| AI-5 | Topically unrelated sources in a market report | Providers are attached to specialists, not to the request, and nothing asked whether a result was on topic before fetching and embedding it. Deterministic relevance filter, applied before ingest. | **Done** |
| AI-6 | Sources whose title is their URL | A PDF has no `<title>` and was fetched down the HTML path — stripped of tags it never had. PDFs are extracted as PDFs; a URL is never stored as a name. | **Done** |

### AI-5, the leading hypothesis — verify before fixing

`discoveryOrchestrator.SPECIALIST_CONNECTOR_KEYS` hard-wires providers to
specialists:

```
data_analysis_specialist:      ['arxiv', 'pmc', 'uspto', 'clinicaltrials']
quantitative_quality_auditor:  ['arxiv', 'pmc', 'uspto', 'clinicaltrials']
feasibility_architect:         ['arxiv', 'pmc', 'uspto', 'clinicaltrials']
```

An opportunity-discovery or market run that schedules any of these fires arXiv
and PubMed Central searches. Those APIs return *something* for almost any query,
and nothing filters a result on topical relevance before ingest. That is exactly
how a paper on Gram-negative bacilli lands in a market report.

**Do not fix by deleting the providers.** Academic sources are right for some
intents. The defect is that provider choice is keyed to the specialist rather
than to the request, and that returned sources are ingested without a relevance
check. Verify against the operator's actual run before changing anything.

### Acceptance

- A golden test per defect that fails against today's `main`.
- AI-3 specifically: a report whose table is truncated must FAIL its contract
  audit, not ship. Shipping half a table and calling it complete is the
  underlying bug; the truncation is the symptom.

---

## P0 — GitHub issue #228 P1: evidence that certifies itself — **DONE**

`sourceSufficiencyGate.ts` returns `sufficient` when `specialistSignalCount > 0`.
That count comes from model-generated arrays. The orchestrator labels specialist
findings "analysis only; not independent evidence" and the gate accepts them as
evidence anyway.

Reachable: retrieval returns zero citable chunks → a specialist model writes a
plausible structured response from its own general knowledge → the run is judged
to have sufficient evidence → an adjudication or story-verification ships a
verdict backed by nothing.

This is circular verification on a product whose entire claim is verification.
It ranks with AI-1..AI-6 and arguably above them.

**Done.** Analytical coverage and independent evidence are separate quantities
and only one can make a run sufficient. All six mandated regression cases are in
`backend/src/__tests__/sourceSufficiencyGate.test.ts` and mutation-verified.

`intentNeedsIndependentExternalEvidence` did not list the four verdict intents —
`adjudication`, `investigation`, `story_verification`, `position_brief` — so the
retrieval independence filter never ran for them. Fixed; the adjudicative set is
exported so the gate and the filter stop keeping separate copies.

The intent-fidelity acceptance matrix is
`backend/src/__tests__/intentFidelityMatrix.test.ts`, with the live-provider
smoke procedure in `docs/INTENT_FIDELITY_SMOKE.md`.

### What the matrix found

- `story_verification` misrouted to `adjudication` on the plainest phrasing
  ("verify whether this story is true"), so a story to check came back shaped
  as a claim/case-for/case-against/verdict document. Fixed.
- `feasibility`'s trigger `\b(feasib|…)\b` could never match "feasible" —
  there is no word boundary between "b" and "l". Every feasibility question
  fell through to the model. Fixed. Same defect class as #221.
- `investigation` and `opportunity_discovery` matched nothing on their plainest
  phrasings; the operator's own request ("find me 20 … niches ranked by income
  potential") resolved to nothing at all. Fixed.
- `recommendation` matched "should I" but not "should we". Fixed.

### Still open from the matrix

`factual_report` and `reference_lookup` have no deterministic route: a bare
"what is X" is genuinely ambiguous, so both depend on the classifier model, and
a provider outage sends those requests somewhere else. The matrix asserts this
as a gap rather than ignoring it — closing it will fail the test and ask
whoever closed it to say so.

---

## P1 — my own regressions from PR #227 (issue #228 P2)

Codex's final review landed after #227 merged. Four are real and three are still
open. These are defects I introduced and they are listed first among my
obligations, not last.

| # | Defect | Status |
|---|---|---|
| 227-a | Queued runs could not be cancelled from the run page | **Done** (`b06ef40`, WO-AH branch) |
| 227-b | `useRunTraceStream` slices to 150 *before* sorting chronologically, so an out-of-order arrival can evict a newer event | **Done** (`09d0502`) |
| 227-c | `deriveRunDisplayTitle` extracts the first sentence *before* stripping Markdown/quote wrappers, so `**A. B.**` splits wrong | **Done** (`09d0502`) |
| 227-d | Extended dossier *search* does not select `run_display_title`, and on a pre-057 database the list falls all the way back to the legacy projection instead of dropping only the missing columns | **Done** — the projection is a ladder now, and search matches the display title |

227-d is the same defect I had already fixed in the run-list query — a ladder
that drops one optional column at a time — and did not apply to its neighbour.
Fixing a class in one place and leaving it in the other is the thing Rule 44 T3
exists to prevent.

---

## P2 — WO-AH, finish the consolidation

| # | Item | Status |
|---|---|---|
| AH-1 | Challenge pass runs on every intent; floor enforced by type and by guard | **Done** (`6a3a2cd`) |
| AH-2 | One adversarial instruction for every run, no engine gate | **Done** (`6a3a2cd`) |
| AH-3 | Devil's Advocate add-on removed | **Done** (`6825d61`) |
| AH-3b | "Skeptic" removed from every user-facing screen | **Done** (`b06ef40`) |
| AH-4 | **One request form.** Merge EZ + Lab + the Standard/Deep toggle into a single form that keeps every capability. | **Done** |
| AH-5 | Stop reading `engineVersion` from the start-research request body | **Done** — every run is the one engine |
| AH-6 | **Quota consequence.** See below. | **Blocked on operator** |

### AH-6 — the one decision waiting on you

Every run now reaches the pipeline that used to be "Deep". The monthly *deep*
sub-cap therefore has two coherent readings, and only you can pick:

- **Every run is a deep run.** Student drops from 15 reports a month to 4, Pro
  from 25 to 5. A large cut for people already paying.
- **The sub-cap stops binding** and the general monthly cap is the only limit.
  Nobody loses capacity; the cost per report rises for runs that used to be
  Standard.

The interim is the second, because it changes nothing about what anyone is
allowed to do today. It lives in ONE constant — `RUN_CONSUMES_DEEP_QUOTA` in
`backend/src/config/researchEngine.ts` — and flips in one line.

---

## P3 — WO-AG, cost accounting (parked by the operator)

He is investigating cost himself. Do not touch cost code.

Recorded so the findings are not lost:

- Nothing has ever written to `model_pricing`. One SELECT, no INSERT, no job.
  The catalog is migration 030's eleven seeded rows.
- Seven of nine default agent roles use models absent from it, so their spend
  records as `$0` — indistinguishable from cheap.
- `/app/admin` has no navigation entry anywhere in the app.
- **Accounting rule, operator-set:** a report's cost is the price at the time it
  was used. Never back-applied, unless he decides to once the product is
  finalised for full production.

---

## P3 — `mapApiRunToVaultRun` fabricates run metrics — **DONE**

The fields are optional on the UI run type now, so "unknown" is sayable and the
mapper stops inventing `evidenceTier: 'supported'` for runs that have done
nothing. `RecentRuns` badges a corroboration tier only when there is one.

---

## Where PR #229 stands

Everything above is on `cursor/one-research-system`, in draft PR #229. CI green
on every check.

Review round 1 produced fifteen findings. Copilot fixed four itself; the other
eleven are fixed and every thread has a reply. Four were P1 — a stranded wallet
hold on the Cancel button this PR adds, five dollars charged for a removed
add-on's stronger pass, and two fixes that computed the right answer and handed
it to something that ignored it.

**Do not merge until both reviewers have gone quiet and every new thread has a
reply.** #227 was merged before the final Codex pass landed, which is how four
defects reached `main`.

### The two things waiting on the operator

1. **AH-6, the deep-report quota.** Every run now reaches the pipeline that
   used to be Deep. Either every run counts as a deep run (Student 15 → 4
   reports a month, Pro 25 → 5), or the sub-cap stops binding and the general
   monthly cap is the only limit. The interim is the second, in one constant,
   `RUN_CONSUMES_DEEP_QUOTA`.
2. **Cost accounting (WO-AG).** Parked at your instruction. Findings recorded
   below; no cost code has been touched.

---

## Standing obligations

- **Rule 44** — full self-check before requesting review; add new defect themes
  with evidence after every review round.
- **Rule 32** — never commit to `main`; branch via the helper.
- **Draft PRs only.** The operator merges.
- **Both bots review and every finding gets a reply before merge.** #227 was
  merged before the final Codex pass landed, which is how four defects reached
  `main`. Do not repeat it: wait for the review to go quiet, not just to appear.
- **Plain English in every update.** Function names and file paths belong in
  commits, not in status reports.
