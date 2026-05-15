# Wave 4 — evidence vs. source vocabulary (scope)

**Parent:** Wave 4 PR-A establishes the **scope contract** and **Rule 31**. **Implementation** is tracked in **PR-B** per [`Wave 4/wave-4-implementation-PR-B.md`](../Wave%204/wave-4-implementation-PR-B.md).

**Goal:** Restore on public marketing surfaces the same distinction the backend already encodes: **primary evidence** (artifacts attached to events) vs. **sources** (documented interpretations — what retrieval returns). This is **vocabulary and positioning copy only**; tier **identifiers**, prompts, pipeline stage names, and inference paths remain fenced.

## Background

Marketing prose has used **“evidence”** generically for retrieved papers, articles, and web text. That conflates **sources** (interpretations) with **evidence** (primary artifacts). The shared epistemic preambles already draw part of this line.

**Verbatim anchor — `RESEARCH_INTEGRITY_KNOWLEDGE_BASE_BLOCK` (line 9 of `backend/src/constants/prompts.ts`):**

```text
- Do not assume mainstream recall equals truth; cross-check structure, mechanism, and primary evidence where possible.
```

**Verbatim anchor — `REASONING_FIRST_PREAMBLE` (line 15 of `backend/src/constants/prompts.ts`):**

```text
- Distinguish clearly: (a) mainstream consensus, (b) currently cited evidence, (c) unexplored reasoning paths.
```

Wave 4 **does not edit** `prompts.ts` (Rule 20). It **surfaces** the distinction on marketing pages, meta tags, README prose, orchestrator **UI progress** copy (non-preamble), and a new methodology section (“What Competitors Actually Say”) using **verbatim** competitor quotes with URLs.

## Definitions (locked)

- **Primary evidence:** An artifact directly attached to an event. Examples: FOIA returns, sensor data, raw datasets, original documents, recordings, primary instruments. **Reserved term** — use only when actually true.
- **Source:** A documented interpretation of an event. Examples: peer-reviewed papers, news articles, blog posts, transcripts, retrieved web text. This is what AI research retrieval returns.
- **Source-corroboration tier:** The strength with which a source is corroborated within the corpus. **Display labels** are user-facing; **backend tier identifiers** (`established_fact`, `strong_evidence`, `testimony`, `inference`, `speculation`) are stability-locked per Rule 28 and **never** renamed in Wave 4.

## Vocabulary mapping table (marketing)

| Current marketing term | Wave 4 term | Backend identifier (unchanged) |
| --- | --- | --- |
| “evidence” (generic) | “sources” | n/a |
| “evidence tiers” | “source-corroboration tiers” | tier enum names locked |
| “evidence card” | “source card” | n/a |
| “Strong evidence” (display label) | “Strong corroboration” | `strong_evidence` (unchanged) |
| “evidence chain” | “citation-and-source chain” | n/a |
| “counter-evidence” | “counter-sources” | n/a |
| “Evidence state” (timeline) | “Corroboration state” | n/a |
| “primary evidence” | “primary evidence” (reserved) | n/a |
| “Reasoning over evidence…” (telemetry) | “Reasoning across sources…” | n/a (UI string only) |

## Tier display label mapping (display only)

| Backend identifier | Old display label | Wave 4 display label |
| --- | --- | --- |
| `established_fact` | Established fact | Established fact |
| `strong_evidence` | Strong evidence | Strong corroboration |
| `testimony` | Testimony | Testimony |
| `inference` | Inference | Inference |
| `speculation` | Speculation | Speculation |

## In Scope (PR-B file inventory)

Marketing prose layer:

- `frontend/index.html` — meta description, JSON-LD, og:description, twitter:description
- `frontend/src/lib/marketingDocumentHead.ts` — default and per-route descriptions
- `frontend/src/pages/LandingPage.tsx`
- `frontend/src/pages/MethodologyPage.tsx` — plus new “What Competitors Actually Say” block
- `frontend/src/pages/AboutPage.tsx`
- `frontend/src/pages/GuidePage.tsx`
- `frontend/src/pages/SampleReportPage.tsx`
- `frontend/src/pages/PricingPage.tsx`
- `frontend/src/pages/ResearchPage.tsx`
- `frontend/src/pages/ResearchPageV2.tsx`
- `frontend/src/pages/ComparePage.tsx` — methodology cross-link teaser
- `frontend/src/components/landing/EvidenceProvenancePanel.tsx` → **`SourceProvenancePanel.tsx`** via `git mv` (PR-B)
- `frontend/src/components/landing/ComparisonTable.tsx`
- `frontend/src/components/landing/LivingReportTimeline.tsx`
- `frontend/src/components/landing/livingReportTimelineData.ts`
- `frontend/src/components/landing/PipelineSchematic.tsx` — **caption / sr-only prose only**; stage names in `pipelineSchematicData.ts` are **out of scope** (Rule 27)
- `frontend/src/components/landing/pipelineSchematicData.ts` — **rationale prose only**
- `frontend/src/components/landing/ModeMatrix.tsx`
- `frontend/src/components/landing/persona/personaContent.ts`
- `frontend/src/content/marketingFaqItems.ts`
- `frontend/src/content/landingFeatureCards.ts`
- `frontend/src/components/layout/Layout.tsx` — corpus nav `desc`
- `README.md` lines 3, 78–80 (marketing subtitle and pipeline table prose); **line 67 identifier strings unchanged**

Orchestrator telemetry (single line, not inference):

- `backend/src/services/reasoning/researchOrchestrator.ts` — progress message: `'Reasoning over evidence...'` → `'Reasoning across sources...'`. **Rule 20 fence:** not part of `REASONING_FIRST_PREAMBLE`, `RED_TEAM_V2_SYSTEM_PREFIX`, model defaults, or inference path (founder-approved per governance).

**Layout (founder override Rule 26):** `PersonaAwareHero.tsx`, `PipelineSchematic.tsx` presentation (stack hero, larger schematic), `TrustStrip.tsx` / `LandingPage.tsx` trust-line presentation — authorized by Michael Brandon Lane for Wave 4 delivery in the same implementation track as PR-B.

## Out of Scope (explicit fence)

- `backend/src/constants/prompts.ts` (entire file) — Rule 20
- `backend/src/services/reasoning/reasoningModelPolicy.ts` and V2 model defaults — Rule 20
- All backend uses of tier identifier strings as **identifiers** (schemas, agents, citation mapper, tests keyed by identifier, Tailwind `tier-*` / `.badge-*` keyed by identifier) — Rule 28
- `evidence_aliases` storage and CSL output — Rule 28
- `frontend/src/components/landing/pipelineSchematicData.ts` — canonical stage names (marquee schematic) — Rule 27
- `frontend/src/components/landing/visual/pipelineLayout.ts` — WO-W animated layout stage coordinates/labels — Rule 27
- Research inference, retrieval, ranking — Rule 20
- SPA / prerender routing contract — Rule 30 (no routing changes for vocabulary)

## “What Competitors Actually Say” — verbatim quotes (PR-B must verify live)

1. Daniel Nadler, OpenEvidence CEO — Sequoia Capital podcast: *"the evidence is peer-reviewed medical literature."* — `https://sequoiacap.com/podcast/training-data-daniel-nadler/`
2. Consensus homepage: *"Verifiable Evidence — Every answer is grounded in real papers, never generated or hallucinated."* — `https://consensus.app/`
3. Elicit blog “Elicit Systematic Review: Now Built for PRISMA 2020”: *"where evidence must be fast and rigorous enough to inform high-stakes decisions."* — `https://elicit.com/blog/systematic-review-for-prisma-2020`
4. OpenAI Deep Research System Card (Feb 25, 2025): *"may struggle with distinguishing authoritative information from rumors, and currently shows weakness in confidence calibration."* — `https://openai.com/index/deep-research-system-card/`
5. Stanford STORM methodology: *"source bias transfer and over-association of unrelated facts."* — `https://storm-project.stanford.edu/research/storm/`

If any quote cannot be verified at commit time, PR-B stops per standing instruction; scope doc records **Open Questions** until replacement or snapshot (Rule 31).

## Acceptance Criteria (PR-A merge)

- This scope doc merged on `main`.
- `.cursor/rules/31-evidence-vs-source-vocabulary.mdc` present with `alwaysApply: true`.
- `docs/governance.md` updated with Wave 4 founder approvals and Rule 26 layout override for enumerated landing work.
- **PR-A PR:** zero file changes outside `docs/` and `.cursor/rules/`.

## Acceptance Criteria (PR-B merge)

- All items in [`Wave 4/wave-4-implementation-PR-B.md`](../Wave%204/wave-4-implementation-PR-B.md) § Deliverables and § Acceptance criteria.
- Build, lint, typecheck, tests green; competitor URL verification logged in PR body.

## Rule References

- Rule 20 — immutability fence (invoked)
- Rule 26 — landing persona / visual (invoked; **layout** exception logged in governance for Wave 4)
- Rule 27 — pipeline stage names (invoked)
- Rule 28 — tier identifier stability (invoked)
- Rule 29 — marketing scope-doc contracts (invoked)
- Rule 30 — prerender / catch-all (invoked)
- **Rule 31** — evidence vs. source vocabulary (new; this doc + `.mdc`)

## Verification (scope doc hygiene)

From repo root:

```bash
npx markdownlint-cli2 "docs/wave-4-evidence-vocabulary-scope.md"
```

## Open Questions

None at scope authoring time. PR-B must re-open if any competitor string fails live verification.
