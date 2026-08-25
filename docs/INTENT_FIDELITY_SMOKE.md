# Intent fidelity — live-provider smoke procedure

The automated matrix (`backend/src/__tests__/intentFidelityMatrix.test.ts`)
runs on every PR with the classifier's model stubbed out. It proves the
configuration is right: each intent gets the template its report type is named
after, recruits the specialists it claims, is challenged at the strength its
request calls for, and either fails closed or delivers a labelled low-evidence
report when nothing independent was retrieved.

It cannot prove a live model produces the document that template describes.
That needs real provider calls, which cost money and are not a per-PR gate
(GitHub #228: "Add separately documented live-provider smoke procedure; do not
require paid live calls for every PR").

## When to run it

- Before a release.
- After changing a system prompt, an output template, a verifier rubric, or the
  section plan.
- After changing which model a role uses.

## How to run it

One run per intent, from the request form, with everything else left alone:

| Intent | Prompt |
|---|---|
| factual_report | What is the current state of solid-state battery manufacturing? |
| adjudication | Fact-check the claim that remote work always decreases delivery speed. |
| investigation | Investigate why the city rail modernization program went over budget. |
| story_verification | Verify whether this story about the factory closure is true. |
| opportunity_discovery | Find me 20 affiliate marketing niches ranked by income potential. |
| feasibility | Is it feasible to run this workload on-premise instead of in the cloud? |
| implementation | Give me an implementation plan for migrating our billing service. |
| how_to | How do I set up mutual TLS between two internal services? |
| comparative | Compare Postgres, MySQL and SQLite for an embedded analytics product. |
| recommendation | Which CRM should we adopt given a small team and a tight budget? |
| timeline | Build a timeline of events leading to the 2023 banking failures. |
| reference_lookup | What is the default port for PostgreSQL? |

## What to check on each finished report

1. **Shape.** The sections are the ones the template names, in that order.
2. **Numbering.** No heading contains its number twice (`16.16`).
3. **Tables.** Anything the request asked to be a table IS a table, with every
   row inside it — no pipe-delimited rows sitting underneath as loose text.
4. **Counts.** If the request named a number of items, the report contains
   exactly that many, each with the fields that were asked for.
5. **Sources.** Every source is plausibly about the request. No source is
   titled with its own URL. The count is proportionate to the report's length.
6. **Vocabulary.** No screen and no heading says "skeptic". A how-to guide does
   not contain a falsification section.
7. **Verdicts.** Adjudication and story verification either reach a conclusion
   backed by sources the user did not supply, or fail loudly. Neither ships a
   verdict with no independent evidence behind it.

Record the run ids. A failure here is a defect in the work queue, not a note in
a spreadsheet.
