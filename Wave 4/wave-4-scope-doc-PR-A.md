# Wave 4 Scope Doc + Rule 31 — Cursor Agent Work Order (PR-A)

You are working on the GooseyPrime/ResearchOne marketing site repository.
This PR establishes the scope contract for Wave 4: the "evidence vs. source"
vocabulary repositioning. It mirrors the Rule 29 / PR #119 → #120 pattern.
Implementation comes in PR-B, NOT this PR.

## Standing instruction (in effect for the entire work order)

On any rule conflict, stop. Quote the rule by ID and line. State the
discrepancy. Ask for (a) founder override, (b) rule amendment, or
(c) defer. Wait for the founder reply. No silent deferral. Do not
proceed past a conflict on your own judgment.

## Mandatory pre-read

Before writing anything, read these in full:

1. `.cursor/rules/20-research-policy-guardrails.mdc` — Immutability fence
   on REASONING_FIRST_PREAMBLE, RED_TEAM_V2_SYSTEM_PREFIX, V2 model
   defaults, and research inference paths. `alwaysApply: true`. This is
   the hard boundary for Wave 4.
2. `.cursor/rules/26-landing-persona-and-visual.mdc` — Persona and visual
   discipline. Wave 4 affects copy on personas; layout untouched.
3. `.cursor/rules/27-animated-pipeline-hero.mdc` — Canonical pipeline
   stage names in
   `frontend/src/components/landing/visual/pipelineLayout.ts`. NOT
   editable without coordinated marketing sign-off — fenced for Wave 4.
4. `.cursor/rules/28-academic-formatting-engine.mdc` — Lossless Evidence
   Aliases stability. Backend tier identifiers (`established_fact`,
   `strong_evidence`, `testimony`, `inference`, `speculation`) are
   stability-locked here. Fenced.
5. `.cursor/rules/29-marketing-scope-doc-contracts.mdc` — The contract
   you are executing against. Wave 4 scope doc must conform.
6. `.cursor/rules/30-vercel-prerender-spa-routing.mdc` — Catch-all
   exclusion alignment. No routing changes in Wave 4.
7. `docs/governance.md` — Founder-override registry. Wave 4 adds an
   entry.
8. `docs/wave-2-5-a11y-scope.md` and `docs/wave-3-f42-prerender.md` —
   Format reference for the scope doc you will produce. Mirror their
   structure (Background, In Scope, Out of Scope, Acceptance Criteria,
   Rule References, Open Questions).
9. `backend/src/constants/prompts.ts` — Lines 9 and 15 of
   `REASONING_FIRST_PREAMBLE` and `RESEARCH_INTEGRITY_KNOWLEDGE_BASE_BLOCK`.
   This is the philosophical anchor for Wave 4: the preamble already
   distinguishes "primary evidence" from "currently cited evidence."
   The Wave 4 work surfaces that distinction publicly. DO NOT edit
   prompts.ts.

## What Wave 4 is

The ResearchOne marketing surfaces currently use "evidence" generically
to describe what the AI retrieval pipeline actually returns: documented
interpretations of events (papers, articles, web text), not artifacts
directly attached to events. The backend `REASONING_FIRST_PREAMBLE`
already encodes the distinction correctly ("primary evidence" vs.
"currently cited evidence"). Wave 4 restores that distinction on the
public surfaces.

Wave 4 is a vocabulary repositioning, a new positioning content block
("What Competitors Actually Say"), and a durable governance rule
(Rule 31). Backend tier identifiers, immutable preambles, and the V2
inference path are out of scope and locked by Rules 20 and 28.

## Deliverables for PR-A

You will produce exactly four files. No implementation changes.

### Deliverable 1 — `docs/wave-4-evidence-vocabulary-scope.md`

Mirror the format of `docs/wave-2-5-a11y-scope.md`. Required sections:

**Background:**
Explain the conflation, quote lines 9 and 15 of `prompts.ts`
(REASONING_FIRST_PREAMBLE / RESEARCH_INTEGRITY_KNOWLEDGE_BASE_BLOCK)
verbatim to show the backend already distinguishes primary evidence
from cited claims, and frame Wave 4 as restoring that distinction on
public surfaces.

**Definitions (lock these into the doc):**
- *Primary evidence:* an artifact directly attached to an event.
  Examples: FOIA returns, sensor data, raw datasets, original
  documents, recordings, primary instruments. Reserved term — use
  only when actually true.
- *Source:* a documented interpretation of an event. Examples:
  peer-reviewed papers, news articles, blog posts, transcripts,
  retrieved web text. This is what AI research retrieves.
- *Source-corroboration tier:* the strength with which a source is
  corroborated within the corpus. Display labels are user-facing;
  backend tier identifiers (`established_fact`, `strong_evidence`,
  `testimony`, `inference`, `speculation`) are stability-locked per
  Rule 28 and remain unchanged.

**In Scope (enumerate every file with line refs):**

Marketing prose layer (file list, copy in the inventory below):
- `frontend/index.html` — meta description, JSON-LD, og:description,
  twitter:description (×3 mentions)
- `frontend/src/lib/marketingDocumentHead.ts` — default route
  description
- `frontend/src/pages/LandingPage.tsx`
- `frontend/src/pages/MethodologyPage.tsx`
- `frontend/src/pages/AboutPage.tsx`
- `frontend/src/pages/GuidePage.tsx`
- `frontend/src/pages/SampleReportPage.tsx`
- `frontend/src/pages/PricingPage.tsx`
- `frontend/src/pages/ResearchPage.tsx`
- `frontend/src/pages/ResearchPageV2.tsx`
- `frontend/src/components/landing/EvidenceProvenancePanel.tsx`
  (component file rename to `SourceProvenancePanel.tsx` is in scope;
  preserve git history with `git mv`)
- `frontend/src/components/landing/ComparisonTable.tsx`
- `frontend/src/components/landing/LivingReportTimeline.tsx`
- `frontend/src/components/landing/livingReportTimelineData.ts`
- `frontend/src/components/landing/PipelineSchematic.tsx` (caption
  prose only; pipeline stage names are Rule 27-fenced)
- `frontend/src/components/landing/pipelineSchematicData.ts`
  (rationale prose only)
- `frontend/src/components/landing/ModeMatrix.tsx`
- `frontend/src/components/landing/persona/personaContent.ts`
- `frontend/src/content/marketingFaqItems.ts`
- `frontend/src/content/landingFeatureCards.ts`
- `frontend/src/components/layout/Layout.tsx` (corpus nav `desc`)
- `README.md` lines 3, 78–80 (marketing-facing subtitle and pipeline
  table only; identifier strings on line 67 remain unchanged)

Orchestrator telemetry copy (single line, NOT inference path):
- `backend/src/services/reasoning/researchOrchestrator.ts:516` —
  progress event copy only. The line currently reads:
  `'Reasoning over evidence...'`. Becomes: `'Reasoning across
  sources...'`. This is UI telemetry, not a prompt. Cite Rule 20
  scope-fence proof in the scope doc: this string is not part of
  any preamble, system prefix, model default, or inference logic.

New content block ("What Competitors Actually Say"):
- New section on `MethodologyPage.tsx` (primary placement —
  epistemology lives here).
- Condensed cross-reference on `ComparePage.tsx` (one-line teaser +
  link to methodology section).
- Five verbatim competitor quotes, each with URL and accessed-date.
  Quotes (do not edit, do not paraphrase, do not characterize beyond
  what the source actually says):

  1. Daniel Nadler, OpenEvidence CEO (Sequoia Capital podcast,
     "Daniel Nadler on OpenEvidence: Doctors' Favorite AI App"):
     "the evidence is peer-reviewed medical literature."
     URL: https://sequoiacap.com/podcast/training-data-daniel-nadler/

  2. Consensus, product homepage tagline:
     "Verifiable Evidence — Every answer is grounded in real papers,
     never generated or hallucinated."
     URL: https://consensus.app/

  3. Elicit, blog post "Elicit Systematic Review: Now Built for
     PRISMA 2020":
     "where evidence must be fast and rigorous enough to inform
     high-stakes decisions."
     URL: https://elicit.com/blog/systematic-review-for-prisma-2020

  4. OpenAI, Deep Research System Card (Feb 25, 2025):
     "may struggle with distinguishing authoritative information
     from rumors, and currently shows weakness in confidence
     calibration."
     URL: https://openai.com/index/deep-research-system-card/

  5. Stanford STORM team, project methodology page:
     "source bias transfer and over-association of unrelated facts."
     URL: https://storm-project.stanford.edu/research/storm/

  Each quote is followed by one short ResearchOne counter-line in
  the brand voice. Draft counter-lines are in the scope doc as
  reference copy; PR-B implements them. The pattern:
  > "[Verbatim competitor quote.]"
  > — [Competitor], [source page]
  >
  > Papers are not evidence. Evidence is what the papers are about.

Vocabulary mapping table (lock into scope doc):

| Current marketing term            | Wave 4 term                       | Backend identifier (unchanged) |
|-----------------------------------|-----------------------------------|--------------------------------|
| "evidence" (generic)              | "sources"                         | n/a                            |
| "evidence tiers"                  | "source-corroboration tiers"      | tier enum names locked         |
| "evidence card"                   | "source card"                     | n/a                            |
| "Strong evidence" (display label) | "Strong corroboration"            | `strong_evidence` (unchanged)  |
| "evidence chain"                  | "citation-and-source chain"       | n/a                            |
| "counter-evidence"                | "counter-sources"                 | n/a                            |
| "Evidence state" (timeline)       | "Corroboration state"             | n/a                            |
| "primary evidence"                | "primary evidence" (reserved)     | n/a                            |
| "Reasoning over evidence..."      | "Reasoning across sources..."     | n/a (telemetry copy)           |

Tier display label mapping (display labels change; identifiers do not):

| Backend identifier   | Old display label   | Wave 4 display label   |
|----------------------|---------------------|------------------------|
| `established_fact`   | "Established fact"  | "Established fact"     |
| `strong_evidence`    | "Strong evidence"   | "Strong corroboration" |
| `testimony`          | "Testimony"         | "Testimony"            |
| `inference`          | "Inference"         | "Inference"            |
| `speculation`        | "Speculation"       | "Speculation"          |

**Out of Scope (enumerate the fence explicitly):**

- `backend/src/constants/prompts.ts` (REASONING_FIRST_PREAMBLE,
  RESEARCH_INTEGRITY_KNOWLEDGE_BASE_BLOCK) — locked by Rule 20
- `backend/src/services/reasoning/reasoningModelPolicy.ts` and any
  V2 model defaults — locked by Rule 20
- All backend tier identifier strings (`established_fact`,
  `strong_evidence`, `testimony`, `inference`, `speculation`) in any
  file: schemas, agent prompts, citation mapper, claim extractor,
  contradiction extractor, report generator, retrieval service,
  openrouter service, monitoring, atlas export, evidence aliaser,
  formatting/CSL, Tailwind tier color tokens, CSS classes
  (`.badge-strong_evidence` etc.), test fixtures, CorpusPage tier
  mapping — locked by Rule 28 (Lossless Evidence Aliases stability)
- `evidence_aliases` storage and CSL output — locked by Rule 28
- Canonical pipeline stage names in
  `frontend/src/components/landing/visual/pipelineLayout.ts` —
  locked by Rule 27
- All research inference paths, retrieval logic, ranking — locked
  by Rule 20

**Acceptance Criteria (measurable):**

- Scope doc merged.
- Rule 31 file present in `.cursor/rules/`.
- `docs/governance.md` updated with the Wave 4 founder-approval
  entry.
- Zero file changes outside `docs/` and `.cursor/rules/` in PR-A.
- All five competitor quotes verified by following the URLs and
  confirming the verbatim string is present on the page. If any
  quote cannot be verified, raise it as an open question in the
  scope doc and propose a replacement quote sourced from one of the
  competitor pages that you do verify.

**Rule References:**
- Rule 20 (immutability fence) — invoked, not amended
- Rule 26 (persona discipline) — invoked, not amended
- Rule 27 (pipeline stage names) — invoked, not amended
- Rule 28 (tier identifier stability) — invoked, not amended
- Rule 29 (this scope-doc contract) — followed
- Rule 31 (new) — drafted in this PR, blessed by founder override
  per `docs/governance.md` entry

**Open Questions:**
List anything ambiguous you encounter while drafting. If none,
state "None."

### Deliverable 2 — `.cursor/rules/31-evidence-vs-source-vocabulary.mdc`

New rule file. Front-matter and structure must match the existing
rules in `.cursor/rules/`. Specifically:

- `description:` short one-line summary
- `alwaysApply: true` — this is a discipline rule that should fire
  on every marketing or public-facing copy change
- `globs:` include `frontend/src/**/*.{ts,tsx}`,
  `frontend/index.html`, `README.md`, `docs/**/*.md` if applicable

Rule body must define:

1. The discipline: reserve "evidence" for primary artifacts
   directly attached to an event; use "sources" /
   "source-corroboration tiers" / "source card" for documented
   interpretations on all public surfaces.
2. The fence: backend tier identifier strings (the five enum names
   listed in Rule 28) are stability-locked and never renamed by
   this rule. Display labels are user-facing and follow the Wave 4
   mapping table.
3. The competitor-quote requirement: when calling out competitors,
   use verbatim quotes with URLs and dated snapshots. No
   characterization beyond what the source itself says. Quotes must
   be reverifiable.
4. The dated-snapshot expectation: if a quote later becomes
   unreachable at its URL, the snapshot must be preserved (Wayback
   Machine, archive.is, or local screenshot in `docs/snapshots/`)
   and the doc updated.
5. Trigger condition: any PR that adds, removes, or changes
   marketing prose; any PR that adds a new public-facing surface;
   any PR that adds competitor-comparison content.
6. Cross-references: Rules 20, 27, 28 fences; Rule 29 scope-doc
   discipline.

### Deliverable 3 — `docs/governance.md` update

Append a new entry at the end matching the existing Wave 2 entry
format. Entry contents:

- Date.
- Scope: "Wave 4 vocabulary repositioning + Rule 31."
- Founder approvals granted:
  - Bless Rule 31 as a new always-apply discipline rule.
  - Confirm orchestrator telemetry string at
    `researchOrchestrator.ts:516` is outside the Rule 20 fence
    (UI progress event, not inference path).
  - Confirm component file rename
    `EvidenceProvenancePanel.tsx` → `SourceProvenancePanel.tsx`
    with `git mv` to preserve history.
  - Confirm display-label change on tier `strong_evidence` from
    "Strong evidence" to "Strong corroboration"; backend identifier
    `strong_evidence` remains unchanged per Rule 28.
- Out-of-scope confirmations: Rule 20 preamble, Rule 28 tier
  identifiers, Rule 27 pipeline stage names — all explicitly NOT
  modified by Wave 4.

### Deliverable 4 — PR description

Standard format. Title:
`docs: wave 4 evidence-vocabulary scope + rule 31 (PR-A)`

Body sections: Summary, Files changed, Rules invoked/added,
Acceptance criteria, Out of scope, Follow-up PR (PR-B
implementation).

## Constraints

- No changes outside `docs/` and `.cursor/rules/` in PR-A.
- No edits to `backend/src/constants/prompts.ts` — locked.
- No edits to backend tier identifier strings — locked.
- No edits to `frontend/src/components/landing/visual/pipelineLayout.ts`
  — locked.
- All five competitor quotes verified at their source URLs. Report
  any quote you cannot verify as an open question, do not invent a
  replacement.
- Conventional commits, atomic per deliverable.

## Stop conditions (apply standing instruction)

- If any competitor quote is unverifiable at its URL: stop and ask.
- If a referenced rule conflicts with the scope: stop, quote rule
  and line, ask for override/amendment/defer.
- If you discover a sixth file or surface where "evidence" appears
  in marketing prose that is not in the inventory above: stop, add
  to scope, ask for confirmation.
- If `docs/wave-2-5-a11y-scope.md` or
  `docs/wave-3-f42-prerender.md` are missing or differ from the
  expected structure: stop and ask.

Proceed.