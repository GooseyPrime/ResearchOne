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

| # | Observed | Where to look first |
|---|---|---|
| AI-1 | Section headings read `16.16`, `18.18` — the number is doubled | `reportGenerator` emits `## ${s.title}`; the template or the model is also numbering. One of the two must stop. |
| AI-2 | Content that should be a table is run-on prose, largely duplicated | The output contract asks for tables; the generator does not enforce shape before accepting the section. |
| AI-3 | The opportunities table shows 13 rows, then continues as delimited text below it | A section budget or token limit truncated the table mid-render and the model continued in plain text. The report was accepted anyway. |
| AI-4 | 9 sources for a long, detail-heavy report | Retrieval yield. Relates to the 0.55 similarity floor (`AGENTS.md:207` — do NOT lower it) and to #221's query-diversity work. |
| AI-5 | Sources are topically unrelated — a Reddit depression scoping review, an Enterobacteriaceae identification paper, an HPLC nitrite assay — in a market/opportunity report | See below. |
| AI-6 | Several sources have the URL as their title (`https://arxiv.org/pdf/2204.08880v1`) | arXiv PDFs ingested with no metadata extraction. A source with no title cannot be assessed by a reader or a model. |

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

## P0 — GitHub issue #228 P1: evidence that certifies itself

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

Full requirements, tests and the intent-fidelity acceptance matrix are in the
issue. Do not restate them here; implement them from there.

---

## P1 — my own regressions from PR #227 (issue #228 P2)

Codex's final review landed after #227 merged. Four are real and three are still
open. These are defects I introduced and they are listed first among my
obligations, not last.

| # | Defect | Status |
|---|---|---|
| 227-a | Queued runs could not be cancelled from the run page | **Done** (`b06ef40`, WO-AH branch) |
| 227-b | `useRunTraceStream` slices to 150 *before* sorting chronologically, so an out-of-order arrival can evict a newer event | **Open** |
| 227-c | `deriveRunDisplayTitle` extracts the first sentence *before* stripping Markdown/quote wrappers, so `**A. B.**` splits wrong | **Open** |
| 227-d | Extended dossier *search* does not select `run_display_title`, and on a pre-057 database the list falls all the way back to the legacy projection instead of dropping only the missing columns | **Open** |

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
| AH-4 | **One request form.** Merge EZ + Lab + the Standard/Deep toggle into a single form that keeps every capability. Delete `ResearchEngineModeToggle`, `DeepResearchUpgradeModal`, the engine query param and its route helpers. | **Open — next** |
| AH-5 | Stop reading `engineVersion` from the start-research request body | Open |
| AH-6 | **Quota consequence.** After AH-5 nothing sets `engine_version`, so `isDeep` is always false: every run counts against the general cap and none against the deep cap. Real change in who can run what. Operator decision, not an implementation choice. | **Blocked on operator** |

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

## P3 — `mapApiRunToVaultRun` fabricates run metrics

`docs/FOLLOW-UP_fabricated-run-metrics.md`. Hardcodes `sourcesRetrieved: 0`,
`contradictionsDetected: 0`, `evidenceTier: 'supported'`. Fixed on the run
workspace; still live for its other callers.

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
