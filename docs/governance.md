# Governance — marketing and landing rules

This document records **where** the binding Cursor rules for the marketing shell live and **when** an explicit founder override has temporarily superseded them for a scoped pull request.

## Rule sources (do not duplicate full rule text here)

| Topic | Location |
| --- | --- |
| Landing persona, default copy parity, lab notebook visual | `.cursor/rules/26-landing-persona-and-visual.mdc` |
| Animated / schematic pipeline hero (reduced motion, canonical stages, performance) | `.cursor/rules/27-animated-pipeline-hero.mdc` |
| Evidence vs. source vocabulary (marketing + public copy) | `.cursor/rules/31-evidence-vs-source-vocabulary.mdc` |
| Dossier canonical reads (`v_dossier` / Rule 32) | `.cursor/rules/32-dossier-canonical-read-path.mdc` |
| Plan confirmation gate (Wave 5.1 / Rule 33) | `.cursor/rules/33-plan-confirmation-gate.mdc` |
| Master pre-commit checklist | `.cursor/rules/00-pre-commit-review.mdc` |

The authoritative rule **text** remains in the `.cursor/rules/*.mdc` files above. This file only adds **override history** so reviewers can see that a given PR operated under an explicit, time-bounded exception.

## Override history

### 2026-05-14 — Wave 5.1 + Rule 33 (plan confirmation gate)

- **Scope:** Migration `035_plan_intent_taxonomy_and_gate.sql`, planning module under `backend/src/services/planning/`, orchestrator Stage 0.5 + `resumeAfterPlanConfirmation`, BullMQ `research:resume_after_plan`, `/api/runs/:runId/plan/*` routes, socket events (`research:plan_*`), `PlanConfirmationPanel` on `ResearchPageV2`, `account_preferences` DDL (schema only in 5.1), **Rule 33** (always-apply).
- **Fence:** Plan LLM prompts remain in `planning/prompts.ts`; **Rule 20** immutable preambles in `constants/prompts.ts` are not repurposed for planning copy.

### 2026-05-14 — Wave 5.0 + Rule 32 (dossier read path)

- **Scope:** Wave 5.0 dossier data model (`034_dossier_data_model.sql`), `/api/dossiers`, in-app `/app/dossiers` routes, Vercel redirects from `/app/reports` (list) to `/app/dossiers`, new **Rule 32** (always-apply).
- **Migration numbering note:** Dossier DDL ships as **`034_*`** because **`033_research_run_citation_style.sql`** already occupied 033. Subsequent Wave 5 waves shift by one (e.g. plan gate migration is **`035_*`**, not `034_*`).
- **Wave 5.3 founder checkpoint (prompt fence):** Any change to skeptic/reasoner **system** text in `backend/src/constants/prompts.ts` remains **Rule 20**–fenced and requires an explicit founder authorization recorded here before merge. Default implementation path for Wave 5.3 is **`backend/src/services/planning/prompts.ts`** (and policy surfaces) unless governance is amended.

### 2026-05-15 — Wave 4 vocabulary + Rule 31 + Rule 26 layout (enumerated)

- **Founder:** Michael Brandon Lane (authorization recorded in project chat, 2026-05-15).
- **Scope:** Wave 4 “evidence vs. source” vocabulary repositioning; new Rule **31**; PR-B implementation per `docs/wave-4-evidence-vocabulary-scope.md` and `Wave 4/wave-4-implementation-PR-B.md`.
- **Approvals granted:**
  - Bless **Rule 31** (`.cursor/rules/31-evidence-vs-source-vocabulary.mdc`) as a new **always-apply** discipline rule for marketing and public-facing copy.
  - Confirm orchestrator **UI progress** string at `backend/src/services/reasoning/researchOrchestrator.ts` (telemetry line changing to “Reasoning across sources…”) is **outside** the Rule 20 immutability fence (not preamble, not model policy, not inference logic).
  - Confirm component rename **`EvidenceProvenancePanel.tsx` → `SourceProvenancePanel.tsx`** via `git mv` to preserve history.
  - Confirm **display-label** change for tier identifier `strong_evidence` from “Strong evidence” to **“Strong corroboration”**; backend identifier **unchanged** per Rule 28.
  - **Rule 26 layout override (enumerated):** for Wave 4 delivery only, authorize **layout** changes to the marketing hero as needed: `PersonaAwareHero.tsx` (stack copy above pipeline), `PipelineSchematic.tsx` / hero region (larger animated schematic footprint), and `TrustStrip.tsx` / `LandingPage.tsx` (presentation of the three trust signals). **Persona default copy parity (Rule 26 I-3)** remains in force unless separately overridden; Wave 4 copy edits must keep default persona strings aligned with `Hero.tsx` where the scope doc requires character-for-character parity.
- **Out of scope confirmations:** `backend/src/constants/prompts.ts` — **not** modified; Rule 28 tier identifier strings — **not** renamed; `pipelineLayout.ts` canonical stage names — **not** modified; research inference paths — **not** modified.
- **Rule text:** Original `.mdc` files are not amended by this entry; this is an episodic, enumerated override and scope contract.

### 2026-05-12 — Wave 2 marquee visual rebuild

- **PR:** https://github.com/GooseyPrime/ResearchOne/pull/117
- **Founder:** Michael Brandon Lane, InTellMe AI (authorization recorded in project chat, 2026-05-12).
- **Rules overridden (scope limited to the enumerated items in that authorization only):** **Rule 26 I-3** and **Rule 27** (see the audit doc for the exact enumerated list: hero copy, `PipelineSchematic`, `LivingReportTimeline`, strict `FeatureCard`, related homepage assembly, and specified marketing routes).
- **Rule text:** Not amended. Overrides are **episodic** and **enumerated**; all other surfaces remain governed by the original `.mdc` files.
