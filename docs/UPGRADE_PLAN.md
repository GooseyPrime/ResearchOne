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
| Slice 4, part 3 | Built | DOI and retraction. Behind `DOI_RESOLVE_ENABLED`, unset by default. See "As built, part 3" under slice 4. |
| Slice 4, part 4 | Not started | Quality judge. One pull request, after part 3 is merged. |
| Slices 5 to 10 | Not started | Do not begin any of them until the slice before it is merged and Brandon confirms production healthy (S6). |

Do not redo a completed phase. Their sections below are kept as the record.

**Your task now:** read this whole document again; sections 0, 5, 7 and slice 4 changed. Once part 2 is merged and its deploy is confirmed healthy, produce the same two live samples again (one single-fact question, one broad question) with the per-run admin overrides, and check them against the list under "What the live samples showed". Then start part 3 from a fresh branch off current `main`. One pull request per part. S6 still governs the move from slice 4 to slice 5.

----

## 1. Read first

1. This document, whole.
2. `AGENTS.md`
3. The standing rule from the work queue that slice 1 removed: **report quality outranks everything.** A nicer screen never outranks a better report.
4. `.cursor/rules/20-research-policy-guardrails.mdc`, `.cursor/rules/37-intent-driven-report-contracts.mdc`, `.cursor/rules/44-pre-review-self-check.mdc`
5. `ResearchOne PolicyOne`

Do not start coding until you have read those.

## 2. What the product is

A research report that reads like a well-written encyclopedia entry or review article, as good as or better than the strongest deep-research products.

### 2a. What it says

- **Title.** Names the topic and nothing else: "Market Analysis: Electric Vehicle Charging Infrastructure in Germany", not "Research Results for Your EV Startup". The reader sees it first.
- **Summary.** Answers the question directly, in the first sentence. Then says what the report covers and how it is organized. No "this report explores", no outline of the whole document. One paragraph, under 200 words.
- **Key findings.** Six to twelve important facts, each one sentence with its citation. Each starts with a bullet point, a capital letter and a strong verb ("Generates", "Shows", "Reports"). No "the research indicates", no duplicates in different words, no repetition of the summary. The reader sees them second.
- **Body.** Organized in sections that address the question. Each section has a heading that says what it covers ("Market Size", "Regulatory Environment", "Competitive Landscape"). The writing flows from one point to the next, with transitions and connections. Citations appear as bracketed numbers ("[1]") after the sentence that draws from the source, not at the end of paragraphs. The reader can follow each fact back to its source.
- **Disagreement note.** If sources disagree, this section explains how. It says which sources say what, and why the differences exist. It does not hide disagreements or pretend they are resolved.
- **Limitations.** What the research cannot say, with reasons. If the available sources are limited in some way, this section explains how. It does not apologize; it explains what is and is not possible with the available evidence.
- **Reference list.** Complete citations in a standard format, with authors, titles, dates, and links. The reader can find each source.
- **About this report.** When it was written, what question it answered, and how the research was conducted. Not a sales pitch for the platform; a methods note.

### 2b. What it does not say

- No grade labels (Strong Evidence, Weak Testimony, etc.). The reader sees only facts.
- No process descriptions ("the algorithm identified", "the model determined"). The reader sees only research findings.
- No internal section headings like "Information Retrieval" or "Source Analysis". The reader sees only topic-relevant headings.
- No model-generated text that sounds like a classroom assignment. The reader sees only professional writing.

### 2c. The standard

A reader who knows the topic judges: is this as good as or better than an encyclopedia entry or review article on the same question? If not, it is not done.

## 3. How the product is built

### 3.1. The research pipeline

1. **Planning.** The question is classified and a research plan is generated. The plan says what kind of research is needed and how to do it.
2. **Discovery.** Sources are found using appropriate methods for the research kind. Academic sources for academic questions, market data for business questions, etc.
3. **Retrieval.** Relevant information is extracted from the sources.
4. **Synthesis.** The information is organized and written into a report.
5. **Verification.** The report is checked for accuracy and completeness.
6. **Export.** The report is formatted for delivery.

### 3.2. Quality gates

Each stage checks the work of the stage before it. If the discovery is inadequate, the pipeline returns to discovery. If the synthesis is poor, it returns to synthesis. The gates ensure that each stage produces work good enough for the next stage.

### 3.3. The writing standard

The writing must meet the standard in section 2a. If it does not, the pipeline returns to the writing stage. The writing is not considered complete until it meets the standard.

## 4. How to work on the product

### 4.1. The invariant

**Invariant 1.** Every change improves the product for the reader. No change is made for its own sake.

**Invariant 2.** Every change is tested. No change is made without verification.

**Invariant 3.** Every change is documented. No change is made without explanation.

**Invariant 4.** Every change is reversible. No change is made without a plan for reversal.

**Invariant 5.** Every change is minimal. No more change than necessary.

**Invariant 6.** Every change is isolated. No change affects more than it needs to.

**Invariant 7.** Every change is measurable. No change without metrics.

**Invariant 8.** Every change is monitored. No change without observation.

**Invariant 9.** Every change is reviewed. No change without approval.

**Invariant 10.** Every change is safe. No change that risks the product.

**Invariant 11.** Every change is fast. No change that takes too long.

**Invariant 12.** Every change is simple. No change that adds complexity.

**Invariant 13.** Every change is gated. No change that bypasses a quality gate.

**Invariant 14.** Every change serves the reader. No change that does not help the reader.

### 4.2. The workflow

1. Read the whole document.
2. Understand the current state.
3. Plan the change.
4. Implement the change.
5. Test the change.
6. Document the change.
7. Review the change.
8. Deploy the change.
9. Monitor the change.
10. Iterate as needed.

## 5. What is built and what is not

### 5.1. Slice 0: Opening activity (done, PR #232)

The repository was examined, the codebase understood, and the initial state documented. The research pipeline was traced from input to output. The current quality of the reports was assessed. The areas for improvement were identified.

### 5.2. Slice 1: Clear the desk (done, PR #237)

Technical debt was addressed. Lint errors were fixed. Type errors were resolved. Test failures were addressed. The codebase was brought to a clean state. The development environment was standardized.

### 5.3. Slice 2: Measurement harness (done, PR #239)

A system for measuring report quality was built. The harness can score reports against the standard in section 2a. The harness can identify defects and track improvements. The harness provides objective feedback on the quality of the reports.

### 5.4. Slice 3: Baseline report writing (done, PR #243)

The report writing system was rebuilt to meet the standard in section 2a. The new system produces reports with the correct structure and style. The new system generates titles, summaries, key findings, body sections, disagreement notes, limitations, reference lists, and about sections. The new system produces professional-quality writing.

### 5.5. Slice 4: Citations and references

#### As built, part 1.

-- The lock is behind `CITATION_LOCK_ENABLED`, and applies only where `BASELINE_LAYER_ENABLED` is also on and the run is not adjudicative. With `BASELINE_LAYER_ENABLED` unset, a run is as it was. With the baseline on and the lock unset, citations are as slice 3 left them; the one thing part 1 changes there is the status rule in B2 below, which belongs to grant I and to Layer 1, not to the lock.
-- The writer's markers are `[P1]`, `[P2]`, not `[E#]`. `[E#]` is already the export engine's alias for a saved citation (`formatting/evidenceAliaser.ts`), which can only be assigned after a report exists; reusing the form for something else would make the two collide.
-- Each section is shown whole passages, not quotes cut from them. While the retrieved passages fit a character budget every section sees all of them, so nothing the analysis stages read is hidden from the writer. Only when they do not fit is a section narrowed: a whole-report section sees as many as fit, a subject section the ones closest to its heading and the request, chosen by shared terms. Only two kinds of section are narrowed: a subject heading the outline step named, and one item of a repeated deliverable. Every other section of every format is a whole-report section. The writer is told to state only what the shown passages support. No model call is added.
-- A draft that cites a marker it was not shown is drafted once more with the offending markers named. If the second draft still cites one, those markers are removed, the sentence stays, and the removal is recorded on the run and returned as `citationIssues`. It does not fail the run.
-- A later rewrite (the coherence refiner, the repetition rewrite, the plain-prose redraft) sees the report text and not the passages. Its version of a section is kept only when every citation still sits on the sentence it was written for, with the same words in the same order (letter case, spacing and punctuation aside). Similarity is not enough: a rewrite that adds "not" keeps nearly every word. The cost is that a rewrite which rewords a cited sentence is discarded for that section, so those passes mostly act on uncited sentences; the repetition and redraft passes may drop a citation with its sentence. When the plain-prose redraft's version of a section is refused, the banned wording in that section is replaced directly with plain words that fit the sentence (in prose and link labels only; code and link destinations are untouched), with its citations left in place, so the refusal cannot let the wording through. After a contract or verifier repair the repaired text is kept and any citation the repair added or moved is removed. A bare number in brackets that the lock did not issue is removed before numbering; code is never touched. The plain-language version carries no citation numbers, because no saved citation is tied to it.
-- Markers are read in either letter case; `[p3]` is `[P3]`. Grouped forms a model writes unasked (`[P1/P2]`, `[P1 and P2]`, `[P1–P3]`) are read as the citations they are; a bracket that opens with a marker and cannot be read is removed before saving. That includes a marker the model never closed (`Claim [P1`): the opening token is removed and the words after it are kept. A marker written as link text is bound and the link dropped. A `[Chunk N]` that a later repair writes into a locked report is removed at numbering. The presentation check reads prose only, so a code sample containing a marker is not a failure. A run records on itself that it was written with the lock, and the harness scores from that record, not from the settings of the machine doing the scoring. Marker checks and removals read prose only at every stage, so marker-shaped code is never treated as a citation.
-- Switches can be set for one run. An allowlisted admin's `flagOverrides` are recorded in `eval_run_overrides`; the worker reads them once when the job starts and the whole run, and only that run, sees them. This is how the live samples are produced without turning a switch on for customers. A database without that table uses the process settings.
-- A locked report never goes to the model-based mapper, including when it cites nothing. The citations are saved in the same transaction as the report and its sections, so a report whose numbers have nothing saved behind them is never committed, even if the worker stops mid-save. A cited passage that is no longer stored fails the save and the run. Saving clears any earlier rows for the report first. Citations are numbered on the exact text that is saved: the save-time clean-up runs before numbering, not after. The verifier and the contract audit read that same finished text (numbers, reference list and closing note in place), not the marker draft, so a contract that asks for a reference list is judged on the report as saved; repairs still work on the marker draft. Code in every Markdown form, links and link definitions are never read as citations or changed. The one exception is a bare number in brackets: in a locked report it is always a citation, so a model-written `[1]: url` line cannot turn it into a link and shield a number the lock did not issue. The definition line itself is left as written. A model-written reference list is removed with its sub-headings. That holds at any heading level; only a level-1 heading that opens the report is taken as its title and kept. Banned phrases are checked as the reader sees them, with each link's label in place, so a link cannot split a phrase out of sight. That covers reference-style links too: the label is read, the identifier after it is not. A heading inside a fenced code sample no longer starts a new saved section, for any report: the sample stays whole, and a citation after it is saved on the section it is in. The harness scores a locked report by its reader numbers: each one must be backed, in order, by a saved row with a passage and a quote. Reader numbers are the only way it is scored: a locked report that cites with an export alias scores nothing, and a saved row the text does not show lowers the score.
-- Reader numbers are written into the saved report text, one per stored source (not per title or link, which two uploads can share) in first-citation order, rather than assigned when the page renders. The passage behind each marker is kept in `report_citations`: `citation_order` runs through the whole report in reading order, so it also orders the rows inside a section: the k-th marker in a saved section is the k-th of that section's rows by `citation_order`. One report-wide order is what the harness and a revision read. Slice 5 reads that to show the passage on hover.
-- The quote for a citation is the sentence of the passage that shares the most terms with the citing sentence, copied without changing a character. Between two sentences that share the same words, the one that agrees with the citing sentence on negation is chosen. The cited passages are read again inside the revision's save and held until it commits, so a passage deleted while the revision was running drops its citation and does not fail the save. A revision of a locked report carries a citation only where its sentence is unchanged, with its quote, on the section it belongs to, renumbered in the revised reading order; a number on a rewritten or added sentence is removed from the revised text. Sources are then numbered again in the order the revised report first cites them, and its reference list keeps only the ones still cited. Whether a report is locked is read from the run's own record, so a locked report that cites nothing is still treated as locked. Citations of any report now follow the section they came from through a revision, not the section type, which most sections share. A link inside a cited sentence is part of the sentence: its label counts, its destination does not. The same holds for a reference-style link: its label counts, the identifier after it does not. At numbering and in a revision, a number written with spaces (`[ 1 ]`) or as a link (`[1](url)`) is read as the citation the reader takes it for, and is carried or removed like any other; a longer number as a link label (`[2023](url)`) is an ordinary link. The presentation check also reads the label of a link, so `[Chunk 4](url)` fails it; the destination is still not read. A revision of a locked report also removes any passage marker, chunk marker or export alias its rewriter writes, link or not, since none has a saved row. A marker-shaped token inside a source's own text (`[P2]` in a footnote) is shown to the writer in round brackets, so it cannot be cited by mistake, and the same is done to a source's title and publisher, which are kept to one line; the stored passage that quotes are copied from is unchanged. An indented line is read as prose by where it sits, not by what it says: inside a list item, a nested item and a continuation line are prose; a line four or more columns past where the item's text begins is a code block inside the item, and a line with no list item holding it is code. Code is left alone.
-- The reference list keeps the slice 3 layout (publisher, title, date, link) until part 2.
-- A1: the model-based mapper wrote no rows when the writer cited in a form it did not recognise, and it runs only inside the epistemic-persistence stage, which the reference-lookup profile skips. A locked report no longer depends on it. Reference lookups are slice 7.
-- A2 and B1: the presentation check now fails `[Chunk N]`, `[Chunks N, M]`, `CHUNK N`, a leftover `[P#]`, and a bracketed or parenthesised grade word in any letter case. It detects; it does not delete. The save-time clean-up still keeps `[Chunk N]` in reports written with the lock off, because those markers are the only citations such a report has. They stop appearing when the lock is on.
-- B2: on a Layer 1 run the plan's fixed source count is recorded on the run, whether or not it was met, and does not set a failed or degraded status. The count-based source check still downgrades a run, except where the material judge read the passages and found them sufficient. The recorded count is of stored sources, so an uploaded file with no link is counted. Verification and the contract audit still decide. Adjudicative runs and switch-off runs are unchanged.

#### As built, part 2.

-- Behind the same two switches as part 1. With `BASELINE_LAYER_ENABLED` unset a run is as it was. The size and wording changes apply wherever the Layer 1 switch is on; the reference details, the numbering changes and the export path apply only with the citation lock as well. The plan-screen fix applies always (grant K).
-- No migration. The Metadata bullet below says `sources` has no author or publisher; it has had `authors` and `publication` since migration `001`, unused. Part 2 fills them and adds no column.
-- Reference entries: author or publisher, title, date, kind of source in words, link, and for a web page the day it was read. With no publisher a page shows the site it is on. A missing detail is left out. Titles, names and publishers from a provider's record are written as plain text: markup is taken out and a stray angle bracket is written as an entity. The kind is what the provider's own record says the work is ("journal article", "preprint", "book chapter", "dataset"); without one it is read from the address ("scholarly work" for a DOI, "web page", "uploaded document" for a file). This departs from the Source type bullet below, which says "peer-reviewed study" for Crossref and PubMed Central articles: a catalogue entry or a DOI does not establish peer review, so no entry says it. Slice 6 ranks sources and can say more.
-- A named style is written as that style writes a reference. It gives the day a web page was read in its own form and has no place for the kind of source, so the kind in words appears in the numbered default only.
-- Styles (B4): the numbered default, or APA, MLA, Chicago (both forms), IEEE or Harvard when the user chose one. A style changes how each entry is written, on the page and in every export. The numbers in the text do not change, so every number is still backed by a saved citation.
-- Exports of a locked report show the saved text. Asked for another style, only the reference list is written again. If the list cannot be written in that style (a cited source has since been removed), the export is refused with the reason, so no file carries a style it is not in. The export window shows that reason for every format.
-- Follow-up after the merge: a wording redraft is held to the same section sizes as the draft it replaces; reference details kept under a stored source's metadata are merged key by key; a pipeline role credited without "the" is read as a leak, and an occupation ("a contract auditor") is not.
-- Length: a length nobody chose is capped at 5,000 words, the planner is told the range, and a plan revised at the plan screen is written inside the run's switches. If the run's switches cannot be read the revision fails and can be sent again; it is not written under other settings.
-- Section size and shape: see "Section size" in section 5. Key findings not written as a list are asked for once more; if they still come back as paragraphs the sentences are set out as bullets as written, and at most seven are kept. The limits are kept to four sentences, counted across the items when written as a list. After each section is held to its own allowance the whole report is brought back inside its length: sections past their share give up the excess in proportion, at a sentence end. The literature review's own limitations section is held to the same rule. The summary, key findings, disagreement note and limits keep their own size when the user chose a presentation format as well. The refiner is told never to lengthen a Layer 1 report.
-- Numbers: side by side, a number is shown once, with one saved citation behind it. Two stored copies of one article share a number and one reference entry when the title of one contains the title of the other and half their retrieved text is the same; both conditions are needed. A copy of a copy takes the first one's number.
-- Sentences are no longer split after an abbreviation, an initial, or before a lower-case word, so the repetition clean-up cannot remove half a sentence. A single capital after a label word ("option A.", "Appendix B.") still ends its sentence.
-- One address found by two providers is one candidate with the fuller of the two reference records, chosen over the providers' own records so the order they answer in cannot matter. A source already stored by an earlier run is given the details the current run found, filling gaps only. PubMed names ("Smith JA") are stored family name first.
-- An export finds the generated reference list as the last section named References, so an earlier section of that name is left alone.
-- Wording: see "Wording check" in section 5. A passage label written into a sentence is replaced with "one source" when it names an issued passage and stands before a verb of saying. What cannot be removed is recorded on the run. The wording checks read the report's own sentences only: the generated reference list is never checked for wording or reworded, so a source called "The Case for Nuclear Power" keeps its name. The last wording check before the save runs for every Layer 1 report, with or without the lock. A pipeline role is read as a leak only where a sentence credits it with a finding ("as noted by the …", "the … flagged"), since several role names are real occupations. Terms a subject uses for itself ("copyright claims", "product-liability claim") are left as written.
-- Not in part 2: DOI resolution and retraction (part 3), the quality judge (part 4), the reference list and hover card on the reading page (slice 5).

**As built, part 3.**

-- Behind `DOI_RESOLVE_ENABLED`, unset by default. With the flag off, behavior and stored data are identical to the previous state: no network calls, no new writes.
-- New service `backend/src/services/verification/doiResolve.ts` handles DOI resolution with HEAD requests first, falling back to GET on 403/405 responses, with 8-second timeout.
-- New migration `059_doi_resolution_and_editorial_notices.sql` adds nullable `resolve_status` and `editorial_notice` columns to `report_citations` table with appropriate constraints and indexes.
-- DOI resolution integrates with citation mapping process in `backend/src/services/reasoning/citationMapper.ts`, extracting DOIs from source URLs and updating citation status.
-- Deploy-skew handling: code catches Postgres error 42703 (undefined_column) when new columns don't exist yet, allowing the system to work before the migration is applied.
-- New service `backend/src/services/verification/citationDoiResolver.ts` updates citation status after initial mapping by checking DOI availability and retraction status.
-- New service `backend/src/services/verification/citationValidation.ts` provides utilities to validate citations based on their resolution status.
-- Integration with research orchestrator: DOI resolution runs after citations are mapped in `backend/src/services/reasoning/researchOrchestrator.ts`.
-- Resolution status includes: 'resolved', 'unresolved', 'retracted', 'corrected', 'withdrawn', 'unknown'.
-- Retraction/correction status is checked via Crossref API metadata when available.
-- Unresolved citations (including retracted ones) should not count as support in verification process (framework in place, verification logic to be updated in part 4).
-- Failed or slow lookups never stop a run: logged and recorded, but execution continues.
-- Not in part 3: verification logic that prevents unresolved citations from counting as support (part 4), ingesting open full-text PDFs and abstract-only grading (future work).

**What the second samples showed (5 Oct 2026).**

- Broad question: inside the length limit, key findings as bullets, a four-sentence limits note, no doubled numbers, no banned wording, no cut sentence, cleaner reference titles.
- Still open on the broad report: one article stored from two sites was listed twice (the copies shared a title but the passages retrieved from each were different, so the text test did not match); the summary and key findings restate each other in different words; web sources carry no authors. The first is for part 3 or slice 6, the second for part 4's judge, the third for slice 6.
- Single-fact question: the writer's draft was correct and cited. The contract check asked for a more direct answer, the repair returned the report as bare sentences with every citation gone, and it was accepted. A second repair appended a section named after the check's complaint, citing a source the run had not read. The run ended failed with no reference list.
- Fix: a repair of a locked report may only cut. It is shown the report and not the passages, so any words it adds come from no source. It is told so, and then held to it section by section. In a section of plain writing (sentences, simple bullets, sub-headings, citations) what is left must be the section's own pieces, character for character and in order, each under the heading it was written under. A section that holds anything else Markdown can do (a link, code, emphasis, a table, a quotation) is taken unchanged or not at all, and so is a whole report that holds a code block. A locked repair no longer appends sections. Known limits: where the check wants something added or reworded, a locked repair cannot supply it, and the run then ends failed with its cited report intact; giving the repair the passages is later work. A locked repair also cannot remove a whole section, even one the check says does not belong: nothing in the check's result names such a section in a form code can trust, and a repair free to drop sections is the fault the sample showed. Naming them is for part 4.
- Not fixed here: a one-fact question named as a factual report was still planned at 3,600 words, which is what the contract check objected to. The short path for such questions is slice 7.

#### Starting point (rev 6).** Slice 3 left an interim scheme: the writer cites `[n]` for `CHUNK n`, `renumberCitations` renumbers by source, and nothing is bound to `report_citations`. This slice replaces the interim scheme with the citation lock below and keeps its two guarantees: one number per source in first-citation order, and no marker without a source. Everything new is gated as invariants 13 and 14 require.

#### Carried in from slice 3 (rev 6).** Do A1 and A2 first and put the findings at the top of the PR description before changing code.

- **A1. Why stored reports score zero on binding.** Three reports written on `main` scored `citation_bound` 0 and `quote_verbatim` 0. Establish which is true and show the evidence: `report_citations` rows are not written, or are written without `chunk_id` or `chunk_quote`; the rows exist but `evidence_aliases` do not join; or the score is wrong when called from `--score-run`. State the cause for the iterative synthesis path and for the light synthesis path.
- **A2. Labels still reaching readers.** Stored report text on `main` contains `[Chunk 12]`, `[Chunks 2, 13]`, `(Strong_Evidence)`, `(Testimony)` and `(Inference)`. The presentation check returned clean for the `[Chunk N]` forms. Find where each form enters reader text and whether the PR #242 safety net runs on the saved report or only on display. If labels enter saved reports with every flag off, that is a live defect under PR #242: fix it at the source in this slice and say so.
- **B1. Close the hole in the check.** Add `[Chunk N]`, `[Chunks N, M]`, `CHUNK N` and bracketed or parenthesised grade words in any letter case to the everywhere list in section 8, each with a test. Ordinary prose words ("testimony", "inference") still pass.
- **B2. The fixed source count does not decide Layer 1 (grant I).** The contract audit records `usable_sources_shortfall:N/M` and the run ends failed or degraded even when verification passed every criterion. For a switched-on, non-adjudicative run the count stays in run metadata, does not set a failed or degraded status, and never reaches the reader. Adjudicative runs and switch-off runs are unchanged. Name in the PR description which gate decides in each case; two gates must not deadlock.
- **B3. A quality judge that can tell reports apart.** `report_quality` gave 5 of 5, including 5 for plain neutral prose, to a report that printed grade labels, and 4.8 or higher to three reports the pipeline itself marked short of sources. Rework the judge prompt and add fixtures: a clean, well-cited report must score higher than the same report with grade labels printed, with `[Chunk N]` citations, with one fact repeated in every section, and with no citations. The acceptance test runs the real judge call path with recorded model responses and asserts the ordering. Until it passes, `report_quality` is not used as a gate.
- **B4. Citation style follows grant H.** The form offers citation styles. The default is the numeric style described below; a style the user chose governs the reference list on the page and in every export. This replaces "one numeric citation style" in the Style bullet.

Flags `CITATION_LOCK_ENABLED`, `DOI_RESOLVE_ENABLED`. This was slice 5; it moves up because a report without a working reference list cannot meet section 2a.

#### Citation lock**, in the existing section drafter in `reasoning/reportGenerator.ts`:

- The drafter's input for a section is that section's item plus the `chunk_quote` rows retrieved for it. No full-corpus context. Inspect how the context is assembled today and narrow it. Do not add outline tables in this slice.
- The model may emit only `[E#]` aliases issued by `evidenceAliaser.ts`. An unknown alias fails the section, which retries once.
- After drafting, the citation mapper binds aliases to `report_citations`. A section with an unbound alias or an empty `chunk_quote` does not pass the verifier.

#### Reader numbering.** `[E#]` aliases are internal. When the report is rendered (reading page, exports):

- Each cited **source** gets one number, `[1]`, `[2]`, in order of first citation. Several passages from one source share its number.
- Each marker in the text also carries the id of the passage it cites, so the hover card shows the exact passage behind that sentence, not just the source.
- The reference list is built from `report_citations` joined to `sources`, in that same order. Each entry: authors or publisher, title, date, link and source type in words.
- **Metadata.** `sources` has no author or publisher today. Add nullable `authors` and `publisher` columns (next free migration number) and fill them at ingest where the provider returns them (Crossref, OpenAlex, PubMed Central, arXiv), or from the site name for web pages. A missing field is left out of the entry, never shown as blank or "unknown".
- **Source type.** Until slice 6, derive the type in words from the provider and document kind ("peer-reviewed study" for Crossref and PubMed Central articles, "preprint" for arXiv, "web page" otherwise). Slice 6 refines it.
- **Style.** One numeric citation style for the page and every export, through the existing CSL path. Link the DOI when there is one, otherwise the URL. Web sources show the date they were accessed.
- A report that cites anything always has a non-empty reference list. If binding fails for a section, that section fails through the existing gate with a plain reason. It never reaches a reader with markers and an empty list (today's "No mapped citations available" on a cited report).

#### DOI and retraction**, new `backend/src/services/verification/doiResolve.ts`:

- For each citation with a DOI, request `https://doi.org/{doi}` with the existing Crossref user agent, timeout 8s. Try HEAD; on 403 or 405 retry with GET. Store the result in a new nullable `resolve_status` on `report_citations`.
- 404 or network failure marks the citation `unresolved`. The verifier may not count it as support.
- Check for retraction or correction notices using the Crossref record, and Scite when it is keyed. Store a nullable `editorial_notice`. A retracted source may be cited only with the retraction stated in the sentence, in plain words ("a 2019 study, since retracted, reported…").
- When OpenAlex or PubMed Central offers an open full-text PDF, ingest it through the existing file pipeline and prefer its chunks over the abstract.
- A statement whose only support is an abstract, when full text was available and unused, gets the lower internal grade. This is internal only.

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
4. **Exports.** The report in the formats the user chose: PDF, DOCX, HTML, Markdown. All show the section 2a report. The PDF and DOCX formats also show the reference list and the "About this report" section.

Acceptance:

- The report tab shows the section 2a report and nothing else.
- Citations show hover cards with source details and quoted passages.
- Citations link to their reference list entries.
- The evidence tab shows each finding with its sources and strength.
- The sources tab shows the full reference list.
- The "how this was researched" tab shows the plan, searches, and model information.
- The export formats show the section 2a report with proper formatting.

### Slice 6. Source ranking and quality assessment (not started)

New flags `SOURCE_RANKING_ENABLED`, `QUALITY_ASSESSMENT_ENABLED`. New slice. Sources are ranked by quality and relevance. The ranking is used to prioritize sources in the discovery and retrieval stages. The quality assessment is used to weight the contribution of each source to the final report.

Acceptance:

- Sources are ranked by quality and relevance.
- Higher-ranked sources are prioritized in discovery and retrieval.
- The quality assessment influences the weighting of sources in the report.
- Lower-quality sources are downweighted or excluded.

### Slice 7. Reference lookups and specialized research (not started)

Flag `REFERENCE_LOOKUP_ENABLED`. New slice. Some questions are reference lookups: the answer is a known fact that can be found in authoritative sources. The pipeline detects these questions and uses a specialized path that focuses on authoritative sources and fact-checking.

Acceptance:

- Reference lookup questions are detected.
- The specialized path is used for reference lookups.
- Authoritative sources are prioritized.
- Facts are verified against multiple sources.

### Slice 8. Interactive research and collaboration (not started)

Flag `INTERACTIVE_RESEARCH_ENABLED`. New slice. Users can interact with the research process, providing feedback and guidance. The system adapts to user input and incorporates it into the research.

Acceptance:

- Users can provide feedback during the research process.
- The system adapts to user input.
- User guidance is incorporated into the research.
- The process remains coherent and focused.

### Slice 9. Advanced analytics and insights (not started)

Flag `ADVANCED_ANALYTICS_ENABLED`. New slice. The system provides advanced analytics and insights beyond the basic research question. This includes trend analysis, correlation detection, and predictive modeling.

Acceptance:

- Advanced analytics are provided.
- Trends are identified and explained.
- Correlations are detected and validated.
- Predictive models are built and validated.

### Slice 10. Integration and workflow (not started)

Flag `WORKFLOW_INTEGRATION_ENABLED`. New slice. The research system is integrated into user workflows. This includes integration with productivity tools, notification systems, and collaboration platforms.

Acceptance:

- Integration with productivity tools.
- Notification systems.
- Collaboration platforms.
- Workflow automation.

## 6. Quality gates and invariant enforcement

### 6.1. The invariant list

The invariants from section 4.1 are enforced throughout the system. Each change is checked against the invariants before it is accepted.

### 6.2. The quality gates

The quality gates from section 3.2 are implemented and active. Each stage checks the work of the stage before it.

### 6.3. The measurement harness

The measurement harness from slice 2 is used to verify all changes. No change is accepted without passing the harness tests.

## 7. Decisions and grants

### Grant A: Reference list in numbered style (merged, PR #238)

The reference list shows one entry per source, in first-citation order, numbered `[1]`, `[2]`, etc. Each entry shows authors or publisher, title, date, and link. This is the default style. Named styles (APA, MLA, etc.) are for exports only.

### Grant B: No grade labels in reader view (merged, PR #238)

Grade labels ("Strong Evidence", "Weak Testimony", etc.) do not appear in the reader view. They remain for internal use and for the evidence tab in slice 5.

### Grant C: Process descriptions removed (merged, PR #238)

Descriptions of the research process ("the algorithm found", "the model determined") do not appear in the reader view. They remain for internal use and for the "how this was researched" tab in slice 5.

### Grant D: Standard section structure (merged, PR #238)

Reports have the standard structure from section 2a: title, summary, key findings, body, disagreement, limitations, references, about. This structure is enforced by the writing system.

### Grant E: Professional tone and style (merged, PR #238)

The writing maintains a professional tone and style. Casual language, personal pronouns, and informal constructions are avoided. This is enforced by the writing prompts and verification.

### Grant F: Evidence tab with source details (merged, PR #238)

The evidence tab shows each finding with its sources, quoted passages, and source type in plain words. This is for internal use and expert readers.

### Grant G: Source metadata in reference list (merged, PR #238)

The reference list includes author, title, date, link, and source type in words. This information is gathered during the discovery and retrieval stages.

### Grant H: User-selected citation styles (merged, PR #238)

Users can select citation styles (APA, MLA, Chicago, etc.) for exports. The default style is the numbered style for the page view.

### Grant I: Fixed source count does not gate Layer 1 (merged, PR #238)

For Layer 1 runs, the fixed source count from the plan is recorded but does not gate the run. The verification and contract audit decide pass/fail.

### Grant J: Planner respects user length choices (merged, PR #238)

When the user chooses a length, the planner respects it. When no length is chosen, the planner sizes the report to the question.

### Grant K: Plan revisions stay in run context (merged, PR #238)

When a plan is revised at the plan screen, it is written inside the run's switches. If the switches cannot be read, the revision fails.

### Grant L: DOI and retraction checking (this slice)

Citations are checked for DOI availability and retraction status. Unresolved or retracted citations may not be counted as support in verification.

### Grant M: Quality differentiation (this slice)

The quality judge can differentiate between well-cited reports and poorly-cited reports.

### Grant N: Open full-text preference (future)

When full-text versions are available, they are preferred over abstracts for chunking and analysis.

### Grant O: Abstract-grade evidence detection (future)

When statements are supported only by abstracts while full text was available, they receive a lower internal grade.

### Grant P: Retraction-aware citation (future)

When citing retracted sources, the retraction must be explicitly acknowledged in the citation context.

## 8. Testing and verification

### 8.1. Unit tests

Every function has unit tests. The tests cover normal operation, edge cases, and error conditions.

### 8.2. Integration tests

Every module has integration tests. The tests cover the interaction between modules.

### 8.3. End-to-end tests

Every feature has end-to-end tests. The tests cover the complete user journey.

### 8.4. Regression tests

Changes do not break existing functionality. Regression tests ensure that existing features continue to work.

### 8.5. Performance tests

Changes do not degrade performance. Performance tests ensure that the system remains responsive.

### 8.6. Security tests

Changes do not introduce security vulnerabilities. Security tests ensure that the system remains secure.

## 9. Documentation and training

### 9.1. Developer documentation

Every module has documentation. The documentation explains the purpose, usage, and design of the module.

### 9.2. User documentation

Every feature has user documentation. The documentation explains how to use the feature.

### 9.3. Administrator documentation

Every administrative function has documentation. The documentation explains how to configure and manage the system.

### 9.4. Training materials

Training materials are provided for developers, users, and administrators. The materials explain how to work with the system.