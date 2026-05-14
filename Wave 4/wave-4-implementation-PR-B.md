# Wave 4 Implementation — Cursor Agent Work Order (PR-B)

You are working on the GooseyPrime/ResearchOne marketing site repository.
This PR implements the Wave 4 vocabulary repositioning contract defined
in `docs/wave-4-evidence-vocabulary-scope.md` (merged in PR-A) and
governed by Rule 31 (`.cursor/rules/31-evidence-vs-source-vocabulary.mdc`).

## Standing instruction (in effect for the entire work order)

On any rule conflict, stop. Quote the rule by ID and line. State the
discrepancy. Ask for (a) founder override, (b) rule amendment, or
(c) defer. Wait for the founder reply. No silent deferral. Do not
proceed past a conflict on your own judgment.

## Mandatory pre-read

Before touching any file, read these in full:

1. `docs/wave-4-evidence-vocabulary-scope.md` — the contract you are
   executing. This prompt enacts it; the doc governs it.
2. `.cursor/rules/31-evidence-vs-source-vocabulary.mdc` — the
   discipline rule. `alwaysApply: true`. Every change in this PR
   must conform.
3. `.cursor/rules/20-research-policy-guardrails.mdc` — immutability
   fence. Do not approach.
4. `.cursor/rules/27-animated-pipeline-hero.mdc` — pipeline stage
   names in `frontend/src/components/landing/visual/pipelineLayout.ts`
   are NOT in scope. Caption prose around the schematic IS in scope.
5. `.cursor/rules/28-academic-formatting-engine.mdc` — backend tier
   identifier strings (`established_fact`, `strong_evidence`,
   `testimony`, `inference`, `speculation`) and the Tailwind tier
   color tokens keyed by those identifiers are stability-locked.
   Display labels are not.
6. `.cursor/rules/29-marketing-scope-doc-contracts.mdc` — scope-doc
   parity. PR-B must not exceed the inventory in the scope doc.
7. `docs/governance.md` — Wave 4 founder approvals already logged.

## Hard fence — do not touch

- `backend/src/constants/prompts.ts` (entire file)
- `backend/src/services/reasoning/reasoningModelPolicy.ts`
- Any V2 model defaults, agent prompts, retrieval logic, ranking
  logic, contradiction extraction logic, claim extraction logic,
  citation mapper logic
- Any of the five backend tier identifier strings as identifiers
  (the strings may appear in JSX as `tier-strong_evidence`,
  `bg-tier-strong_evidence`, `.badge-strong_evidence`,
  `tier: 'strong_evidence'` — these are unchanged in PR-B)
- `frontend/tailwind.config.js` tier color tokens
- `frontend/src/index.css` `.badge-*` classes that reference tier
  identifiers
- `frontend/src/components/landing/visual/pipelineLayout.ts` —
  canonical stage names, Rule 27 fence
- All test fixtures that assert against tier identifier strings
- `evidence_aliases` storage schema and CSL output
- The README pipeline-table line that uses identifier strings
  (`README.md` line 67) — display-label edits only

If you find yourself about to edit any of the above, STOP and apply
the standing instruction.

## Deliverables for PR-B

Six logical commits, in this order. Conventional Commits format.

---

### Commit 1 — `chore: rename EvidenceProvenancePanel to SourceProvenancePanel`

Use `git mv`:

```
git mv frontend/src/components/landing/EvidenceProvenancePanel.tsx \
       frontend/src/components/landing/SourceProvenancePanel.tsx
```

Then in the renamed file:
- Rename the `export default function EvidenceProvenancePanel()` to
  `export default function SourceProvenancePanel()`.
- Update the JSX prose body per the find-and-replace map in Commit 3.
- Preserve all class names that reference tier identifiers
  (`bg-tier-strong_evidence`, `tier-strong_evidence/10`,
  `tier-strong_evidence/40`, `tier-strong_evidence/20`,
  `focus:ring-1`, `focus:ring-tier-strong_evidence`). These are
  Rule 28-fenced.
- Update the `aria-label`:
  - From: `"Claim 1: performance gains on reasoning benchmarks
    — Strong evidence"`
  - To:   `"Claim 1: performance gains on reasoning benchmarks
    — Strong corroboration"`

Then update every import site:

```
grep -rn "EvidenceProvenancePanel" frontend/src --include="*.tsx" \
  --include="*.ts"
```

Update all matches to `SourceProvenancePanel`. Verify with a second
grep that returns zero results before committing.

---

### Commit 2 — `feat(telemetry): retitle orchestrator progress copy 'Reasoning across sources'`

Single-line change.

File: `backend/src/services/reasoning/researchOrchestrator.ts`
Line: 516

Current:
```ts
await progress('reasoning', 50, 'Reasoning over evidence...', { substep: 'reasoner_started' });
```

Change to:
```ts
await progress('reasoning', 50, 'Reasoning across sources...', { substep: 'reasoner_started' });
```

Justification (paste into commit body): "UI progress event copy
only. Not part of REASONING_FIRST_PREAMBLE,
RED_TEAM_V2_SYSTEM_PREFIX, model defaults, or inference path.
Rule 20 fence preserved. Founder-approved per docs/governance.md
Wave 4 entry."

If a test asserts against the literal string
`'Reasoning over evidence...'`, update the test to assert against
`'Reasoning across sources...'` in the same commit. If no such test
exists, note that in the commit body.

---

### Commit 3 — `feat(marketing): apply Wave 4 evidence-vs-source vocabulary across public surfaces`

This is the bulk find-and-replace. Apply the mappings below file-by-file. Mappings are contextual — do not run a blind global regex. Read each match and confirm the replacement preserves grammar and meaning. When you finish, run the verification grep at the end of this commit and confirm zero unintentional residue.

#### Vocabulary map (apply to prose only, never to identifiers, classNames, type strings, or test data)

| Pattern                            | Replacement                                |
|------------------------------------|--------------------------------------------|
| `evidence-tier discipline`         | `source-tier discipline`                   |
| `evidence-tier`                    | `source-corroboration tier`                |
| `evidence tiers`                   | `source-corroboration tiers`               |
| `Evidence Tiers`                   | `Source-Corroboration Tiers`               |
| `Evidence tiers, surfaced`         | `Source-corroboration tiers, surfaced`     |
| `evidence card`                    | `source card`                              |
| `Evidence card`                    | `Source card`                              |
| `Strong evidence` (display label)  | `Strong corroboration`                     |
| `Auditable evidence chain`         | `Auditable citation-and-source chain`      |
| `counter-evidence`                 | `counter-sources`                          |
| `Evidence state:` (timeline)       | `Corroboration state:`                     |
| `Browse evidence` (nav desc)       | `Browse sources`                           |
| `evidence space`                   | `source space`                             |
| `evidence base`                    | `source base`                              |
| `evidence moving along the spine`  | `sources moving along the spine`           |
| `evidence is mixed`                | `sources are mixed`                        |
| `Tiered evidence summary`          | `Tiered source summary`                    |
| `evidence-gathering`               | `source-gathering`                         |
| `gathering evidence`               | `gathering sources`                        |
| `Gathers evidence`                 | `Gathers sources`                          |
| `Evaluates evidence tiers`         | `Evaluates source-corroboration tiers`     |
| `tags all claims by evidence tier` | `tags all claims by source-corroboration tier` |
| `evidence from`                    | `sources from`                             |
| `what the evidence actually says`  | `what the sources actually say`            |
| `the evidence`                     | (case-by-case: usually `the sources`; if context truly means a primary artifact, keep `evidence`) |
| Generic standalone `evidence`      | (case-by-case: `sources` unless primary artifact) |

#### Reserved — DO NOT change these phrases

- `primary evidence` — keep verbatim, this is the reserved term
- The Rule 28-fenced identifiers
- Any prose that quotes the backend preamble verbatim
- All five competitor quotes in the new content block (verbatim
  rule)
- `Evidence-Based Medicine`, `evidence-based` when it refers to an
  external named methodology like EBM (medical literature term);
  this is a proper noun, not our claim
- `Lossless evidence aliases` (Rule 28 brand term, identifier)

#### Per-file edit plan

For each file below, read first, locate every "evidence"/"Evidence"
match, decide per-match using the map. Skip class names, Tailwind
tokens, type literals, test assertions, and rule-fenced strings.

1. `frontend/index.html` — three meta description fields. Replace
   the entire description string in each (JSON-LD, og:description,
   twitter:description) with this exact copy:
```
   Reasoning-first research with source-corroboration discipline,
   contradiction preservation, and provenance you can verify.
```

2. `frontend/src/lib/marketingDocumentHead.ts` — line 17 default
   description. Replace with:
```
   ResearchOne — disciplined anomaly research. Reasoning-first
   epistemic policy: preserve contradictions, source-corroboration
   discipline, provenance you can verify.
```
   Then audit every other per-route description in this file for
   "evidence" residue and apply the map.

3. `frontend/src/pages/LandingPage.tsx` — section title,
   sample-card description, sample-card example, sample report
   code block (×2). Apply map.

4. `frontend/src/pages/MethodologyPage.tsx` — three pipeline-stage
   role descriptions, sample report code block (×2). Apply map.
   THEN add the new content block per Commit 4.

5. `frontend/src/pages/AboutPage.tsx` — the H1 sentence
   `"refuse to sanitize the evidence"`: change to
   `"refuse to sanitize the sources"`. Read the surrounding
   paragraph; if the meaning intends primary artifacts (rare),
   raise as open question.

6. `frontend/src/pages/GuidePage.tsx` — intro paragraph, three
   agent descriptions, the heading
   `Evidence Tiers — Critical Distinction`. Heading becomes:
   `Source-Corroboration Tiers — Critical Distinction`.
   Apply map to body. Update tier display labels per the table in
   Commit 5.

7. `frontend/src/pages/SampleReportPage.tsx` — sample report code
   block prose only. Apply map.

8. `frontend/src/pages/PricingPage.tsx` — Living-reports
   description. Apply map.

9. `frontend/src/pages/ResearchPage.tsx` and `ResearchPageV2.tsx` —
   stage descriptors, page subtitle, BYOK doc inline content.
   Apply map.

10. `frontend/src/components/landing/SourceProvenancePanel.tsx`
    (renamed in Commit 1) — body prose update:
    Current sentence:
    > Citation integrity isn't a feature — it's the contract. Each
    > claim maps to an evidence card.
    Becomes:
    > Citation integrity isn't a feature — it's the contract. Each
    > claim maps to a source card.
    Apply map to remaining prose. Component caption "Right:
    evidence cards" becomes "Right: source cards".

11. `frontend/src/components/landing/ComparisonTable.tsx` — row
    `{ capability: 'Auditable evidence chain', ... }` →
    `{ capability: 'Auditable citation-and-source chain', ... }`.
    Audit the rest of the table for residue.

12. `frontend/src/components/landing/LivingReportTimeline.tsx` —
    `Evidence state:` label → `Corroboration state:`.

13. `frontend/src/components/landing/livingReportTimelineData.ts` —
    synthesis badge text. Apply map.

14. `frontend/src/components/landing/PipelineSchematic.tsx` —
    caption "evidence moving along the spine" → "sources moving
    along the spine". PIPELINE STAGE NAMES IN
    `pipelineLayout.ts` ARE FENCED — DO NOT TOUCH.

15. `frontend/src/components/landing/pipelineSchematicData.ts` —
    stage rationale prose (×3). Apply map.

16. `frontend/src/components/landing/ModeMatrix.tsx` —
    `Contested questions where evidence is mixed` →
    `Contested questions where sources are mixed`.
    `Tiered evidence summary` → `Tiered source summary`.

17. `frontend/src/components/landing/persona/personaContent.ts` —
    UAP proofLine ("Five evidence tiers from..." → "Five
    source-corroboration tiers from..."), UAP subhead, academic
    subhead "evidence card" → "source card", academic proofLine,
    patent proofLine. Apply map per match.

18. `frontend/src/content/marketingFaqItems.ts` — five FAQ answers
    using "evidence". Apply map. If any FAQ answer would benefit
    from the new positioning (the primary-vs-source distinction),
    leave the rewrite for Commit 4 and just apply the
    find-and-replace here.

19. `frontend/src/content/landingFeatureCards.ts` — card 2
    headline `'Evidence tiers, surfaced'` →
    `'Source-corroboration tiers, surfaced'`. Audit card body.

20. `frontend/src/components/layout/Layout.tsx` — corpus nav
    `desc: 'Browse evidence'` → `desc: 'Browse sources'`.

21. `README.md` — line 3 marketing subtitle:
    Current: "A structured evidence-gathering, reasoning, and
    long-form research reporting system..."
    Becomes: "A structured source-gathering, reasoning, and
    long-form research reporting system that preserves the
    distinction between primary evidence and documented sources..."

    README lines 78–80 (pipeline marketing table):
    Apply map to prose. DO NOT touch line 67 which uses identifier
    strings.

#### Verification at end of Commit 3

Run these greps and confirm the results:

```
# Should return ONLY: rule-fenced identifier usages, prompts.ts,
# preserved "primary evidence" phrases, EBM proper-noun usages,
# and any quote-blocks that quote the preamble or competitors
# verbatim.
grep -rni "evidence" frontend/src --include="*.tsx" --include="*.ts" \
  | grep -v "tier-strong_evidence\|strong_evidence'\|strong_evidence\"\|badge-strong_evidence\|primary evidence\|evidence-based medicine\|evidence_aliases\|Lossless evidence"

# Should return ONLY rule-fenced identifier usages.
grep -rni "evidence" frontend/index.html

# README marketing prose check.
grep -ni "evidence" README.md
```

If any line returned is a marketing-prose match you did not
intend to preserve, fix it in this commit before moving on.

---

### Commit 4 — `feat(methodology): add 'What Competitors Actually Say' content block`

Add a new section to
`frontend/src/pages/MethodologyPage.tsx`, placed below the
existing pipeline/tier explainer and above the Living Report
section (or wherever in the page the existing structure has a
natural epistemology block).

Component name: `WhatCompetitorsActuallySay`. If the page uses
inline sections rather than extracted components, follow the
page's existing pattern.

Section structure:

- Heading (H2, semantic, in-page anchor `#what-competitors-say`):
  `What Competitors Actually Say`
- Lead paragraph (one short paragraph, brand voice):
  > Most AI research tools call retrieved papers "evidence."
  > Papers are not evidence. Evidence is what the papers are
  > about — FOIA returns, raw data, sensor data, recordings,
  > primary documents. Everything else is a source: a documented
  > interpretation of an event. ResearchOne's reasoning preamble
  > has always distinguished the two. We refuse to flatten the
  > distinction on the surface, either.
- Five quote cards. Each card is a `<figure>` with `<blockquote>`
  and `<figcaption>` (semantic, accessible). Verbatim content
  below — do not edit, do not paraphrase.

Quote 1:
> Blockquote: "the evidence is peer-reviewed medical literature."
> Attribution: Daniel Nadler, OpenEvidence CEO, on the Sequoia
> Capital podcast.
> URL: https://sequoiacap.com/podcast/training-data-daniel-nadler/
> Counter-line (ResearchOne voice, plain): "Peer-reviewed
> medical literature is a source. The patients, the trials, the
> instruments — those are the evidence."

Quote 2:
> Blockquote: "Verifiable Evidence — Every answer is grounded in
> real papers, never generated or hallucinated."
> Attribution: Consensus, product homepage.
> URL: https://consensus.app/
> Counter-line: "Real papers can still be wrong, retracted, or
> contradicted by other real papers. Grounding in papers is
> grounding in sources, not in evidence."

Quote 3:
> Blockquote: "where evidence must be fast and rigorous enough
> to inform high-stakes decisions."
> Attribution: Elicit, blog post "Elicit Systematic Review: Now
> Built for PRISMA 2020."
> URL: https://elicit.com/blog/systematic-review-for-prisma-2020
> Counter-line: "Systematic review is the disciplined synthesis
> of sources. The output is a tiered source summary, not new
> evidence."

Quote 4:
> Blockquote: "may struggle with distinguishing authoritative
> information from rumors, and currently shows weakness in
> confidence calibration."
> Attribution: OpenAI, Deep Research System Card (Feb 25, 2025).
> URL: https://openai.com/index/deep-research-system-card/
> Counter-line: "A Skeptic agent on every claim is how we make
> the distinction explicit — not a hope, a stage."

Quote 5:
> Blockquote: "source bias transfer and over-association of
> unrelated facts."
> Attribution: Stanford STORM project team, methodology page.
> URL: https://storm-project.stanford.edu/research/storm/
> Counter-line: "Honest self-criticism, and a known failure mode
> for any retrieval-only system. Contradiction preservation and
> a skeptic pass are how we counter it."

Constraints on this block:

- All five URLs verified live; the verbatim quoted strings appear
  on the linked pages at time of commit. If any quote fails
  verification, STOP and apply the standing instruction. Do not
  silently substitute a different quote.
- Accessibility: every blockquote has a `cite` attribute set to
  the source URL; every figcaption identifies the speaker and
  source publication; counter-lines are NOT inside the
  blockquote (separate paragraph with explicit "ResearchOne
  response:" or a clear visual divider). Pass the in-scope axe
  rules from Wave 2.5 (aria-hidden-focus, aria-prohibited-attr,
  nested-interactive, landmark-one-main, region).
- Each card has a "Verify at source" link with `rel="noopener
  noreferrer"` and `target="_blank"`.
- Lighthouse Accessibility ≥ 95 on `/methodology` after this
  block lands. Wave 2.5 target preserved.

Add a one-line cross-reference on `ComparePage.tsx` at the top
of the comparison table:

> A note on language: most AI research tools call retrieved
> papers "evidence." We don't. See
> [What Competitors Actually Say](/methodology#what-competitors-say).

---

### Commit 5 — `feat(ui): apply Wave 4 tier display labels`

Display labels only. Backend identifiers UNCHANGED.

Find every JSX surface that renders the human-readable tier name
for the `strong_evidence` identifier (typically via a mapping
object in `GuidePage.tsx`, `SourceProvenancePanel.tsx` aria-label,
`CorpusPage`, etc.):

Old label: `"Strong evidence"`
New label: `"Strong corroboration"`

The other four labels are unchanged. Confirm:

| Identifier (locked)  | Display label (this commit) |
|----------------------|------------------------------|
| `established_fact`   | "Established fact"           |
| `strong_evidence`    | "Strong corroboration"       |
| `testimony`          | "Testimony"                  |
| `inference`          | "Inference"                  |
| `speculation`        | "Speculation"                |

If you find a tier-label mapping object/file (something like
`tierLabels.ts` or inline in a page), make the change there and
verify all consumers read from it. If no such central mapping
exists, the change is per-call-site — grep `"Strong evidence"`
(quoted, case-sensitive) and update every match in JSX/prose only.

Do not touch backend tier identifiers, Tailwind tokens, CSS
classes, or test fixtures asserting against identifiers. If a test
asserts against the display label `"Strong evidence"`, update it
to `"Strong corroboration"` in the same commit.

---

### Commit 6 — `test: verify Wave 4 vocabulary parity and competitor-quote integrity`

Add tests under the project's existing test directory. Two test
suites:

**Suite A — vocabulary parity:**
Static-content test that asserts:
- No file under `frontend/src/**` (excluding test files and rule-
  fenced identifier sites) contains a marketing-prose match of
  `/\bevidence\b/i` outside the allow-list (preamble quotes,
  competitor quotes, EBM proper nouns, "primary evidence",
  identifier literals).
- The new `WhatCompetitorsActuallySay` section renders the five
  blockquotes with `cite` attributes equal to the five canonical
  URLs.
- Tier label mapping returns `"Strong corroboration"` for the
  `strong_evidence` identifier.

**Suite B — competitor-quote URL integrity:**
A skipped-by-default test (or a script under `scripts/`) that:
- Fetches each of the five competitor URLs.
- Asserts the verbatim quoted string is still present in the
  fetched HTML.
- Outputs a PASS/FAIL line per URL.
- Failure does not break CI; it produces a warning so the team
  knows a snapshot may be needed. Per Rule 31, an unreachable
  quote requires a preserved snapshot in `docs/snapshots/`.

If the project uses Vitest, write Vitest tests. If Jest, Jest. If
Playwright is already wired (Wave 3 introduced it for prerender),
prefer Playwright for the integration check.

---

## Acceptance criteria for PR-B

- All six commits land in the listed order.
- `npm run build` succeeds.
- `npm run lint` and `npm run typecheck` (or repo equivalents)
  pass.
- All existing tests pass; new Wave 4 tests pass.
- The Wave 3 prerender (F-42) still emits per-route head tags
  correctly; `curl https://www.researchone.io/methodology` raw
  HTML contains the new meta description from Commit 3.
- Lighthouse Accessibility ≥ 95 on `/`, `/methodology`, `/pricing`
  (Wave 2.5 target preserved).
- Lighthouse SEO ≥ 90 on `/`, `/methodology`, `/pricing` (Wave 3
  target preserved).
- The five competitor URLs all return the verbatim quoted strings
  at commit time (manual verification logged in PR description).
- Visual regression: no layout shift on `/`, `/methodology`,
  `/compare`, `/about`, `/guide`, `/pricing`. New section on
  `/methodology` is the only intentional layout addition.

## Stop conditions (apply standing instruction)

- If any of the five competitor quotes fails verification at its
  URL: stop, quote the URL and the missing string, ask for
  override (preserve via snapshot), replacement (new verified
  quote), or defer.
- If a referenced rule conflicts with a planned edit: stop, quote
  rule and line, ask for override/amendment/defer.
- If you find an "evidence" usage in marketing prose that the
  scope doc did not enumerate AND that you cannot classify under
  the existing reserved-phrase allow-list: stop, add to scope,
  ask for confirmation.
- If a test that does not appear to be Rule 28-fenced asserts
  against the literal string `"Strong evidence"`: stop, surface
  the test path, ask whether to update or escalate.
- If the orchestrator telemetry string change in Commit 2 breaks
  a downstream consumer (substep matcher, log aggregator, etc.):
  stop, surface the consumer, ask for override or compatibility
  shim.

## PR description format

Title: `feat(marketing): wave 4 evidence-vs-source vocabulary
implementation (PR-B)`

Body sections:
- Summary (link to PR-A scope doc and Rule 31)
- Commits list (the six above) with one line each
- Files changed (count and high-level grouping)
- Verification results:
  - Build/lint/typecheck/tests status
  - Lighthouse scores (a11y + SEO) on `/`, `/methodology`,
    `/pricing`
  - Curl check on `/methodology` confirming prerendered head
  - Manual verification log for each of the five competitor URLs
- Rules invoked: 20 (fence preserved), 27 (fence preserved), 28
  (fence preserved), 29 (scope-doc parity), 31 (compliance)
- Out of scope confirmation: prompts.ts untouched, V2 inference
  path untouched, tier identifier strings untouched, pipeline
  stage names in pipelineLayout.ts untouched.
- Follow-up items (if any new patterns surfaced that could
  warrant a Rule 32 — flag for founder)

Proceed.