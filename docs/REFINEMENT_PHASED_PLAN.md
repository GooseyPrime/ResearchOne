# ResearchOne Refinement Phased Plan

**Status:** Living document for all agents and contributors.  
**Last updated:** 2026-08-04  
**Logo decision:** Option 3 — The Contradiction Ring (Möbius-style parallel strokes in a rounded hexagon). Symbolizes preservation of contradiction without forced collapse; bridges consensus and anomaly.

This plan implements the recommendations from the August 2026 platform audit. It preserves the original PolicyOne / adversarial research DNA (reasoning-first, assume fringe claims may contain truth, seek supporting evidence + outlier connections, refuse silent debunking) while making the system correctly route *any* user research intent through the multi-agent pipeline.

---

## Guiding Principles

1. **Epistemic transparency** — Users must see *how* ResearchOne will think about their query (intent, skeptic/steelman posture, stages).
2. **PolicyOne DNA is non-negotiable** for investigation / adjudication / story_verification / position_brief paths.
3. **Intent-driven orchestration** — Every IntentId maps to a concrete OrchestrationProfile (agentsToRun/Skip, skepticMode, steelmanMode).
4. **No silent defaults** that hide adversarial capability or force consensus-only answers.
5. **Human-readable everything** — Stage labels, posture labels, and guidance use plain language.

---

## Phase 1 — Routing Visibility (PR #188)

**Goal:** Make intent routing and epistemic posture visible in the Deep Research UX without changing backend contracts.

### Deliverables
- [x] Frontend intent taxonomy parity with backend (`intentTaxonomy.ts`)
  - Add missing: `story_verification`, `opportunity_discovery`, `feasibility`, `implementation`
  - Files: `frontend/src/constants/intentLabels.ts`, `frontend/src/lib/intents.ts`
- [x] PlanConfirmationPanel shows **Epistemic posture** block
  - Read `orchestrationProfile` (or equivalent) from `planPayload`
  - Display human labels for `skepticMode` (`off` / `annotate` / `gate`) and `steelmanMode`
  - Keep auto-confirm, refine, save-profile, confirm/cancel intact
- [x] Live progress labels normalized to pipeline vocabulary
  - Planning → Discovery → Retrieval → Reasoning → Challenge → Synthesis → Verification
  - File: `frontend/src/utils/researchLiveStatus.ts` (+ any stage maps in ResearchDeepPage)
- [ ] Advisory goal chips on Deep Research form
  - Phrases that steer natural language toward common intents without hard-forcing classifier
  - Do not bypass the plan gate

**Acceptance criteria**
- All 16+ intents have display labels + short descriptions on frontend
- Plan gate shows Intent + confidence + Epistemic posture
- Live runs use friendly stage names
- Goal chips are advisory only

---

## Phase 2 — Epistemic Transparency & User Guidance

**Goal:** Make PolicyOne / adversarial stance understandable and controllable by users.

### Deliverables
- Surface a short, plain-language explanation of "how ResearchOne thinks" on:
  - PlanConfirmationPanel (expandable)
  - Methodology / Guide pages
  - First-run / onboarding
- Explicit posture indicators that differentiate:
  - Neutral / encyclopedic paths
  - Challenge / skeptic-gate paths
  - Steelman / position-brief paths
- Intent override or "I meant a different research goal" control at the plan gate (lightweight)
- Marketing copy updates that celebrate the "slivers of truth / outlier bridging" capability without requiring every user to be in adversarial mode
- In-app tooltips / help text for each major intent

**Key files likely touched**
- `frontend/src/components/research/PlanConfirmationPanel.tsx`
- `frontend/src/pages/MethodologyPage.tsx`, `GuidePage.tsx`, `OnboardingPage.tsx`
- Marketing content under `frontend/src/content/` and landing components
- Possibly `frontend/src/lib/agentDisplayDescriptions.ts` for posture language

---

## Phase 3 — Visual & Branding Alignment

**Goal:** Align visual identity with the selected Contradiction Ring logo and the epistemic philosophy.

### Deliverables
- Integrate Logo Option 3 across header, favicon, OG images, marketing
- Update hero / pipeline diagrams / animated visuals to emphasize:
  - Bridges between consensus clusters and anomalies
  - Non-collapse of contradiction (Möbius / dual-stroke motifs)
- Consistent lab-notebook + depth aesthetic
- Dark-mode first polish on plan gate, live status, dossier views

---

## Phase 4 — Orchestration Hardening

**Goal:** Replace placeholders and make routing reliable.

### Deliverables
- Retire or flesh out `wave5_placeholder_*` profiles
- Ensure every IntentId has a production-grade OrchestrationProfile
- Improve lexical + LLM classifier robustness (reduce brittleness)
- Complete steelman agent wiring (Wave 5.3)
- Unify intent → profile → mode resolution paths
- Stage-name and marketing vocabulary parity

**Key backend files**
- `backend/src/services/planning/orchestrationProfiles.ts`
- `backend/src/services/planning/intentTaxonomy.ts`
- `backend/src/services/reasoning/researchOrchestrator.ts`
- Classifier / planning services

---

## Phase 5 — Agent Guidance, Docs & Long-term Maintainability

**Goal:** Make the system self-documenting for both human and AI agents.

### Deliverables
- Keep this file (`docs/REFINEMENT_PHASED_PLAN.md`) as the single source of truth
- Update `AGENTS.md` / governance docs with PolicyOne posture rules and intent routing invariants
- User-facing "How ResearchOne researches" guide that explains the multi-agent pipeline and epistemic stance by intent
- Telemetry / cost notes for new paths
- Regression tests for intent parity and posture display

---

## Current Status

| Phase | Status          | Notes                                      |
|-------|-----------------|--------------------------------------------|
| 1     | In progress     | PR #188 — implementing routing visibility |
| 2     | Ready to start  | After PR 188 is merged & closed            |
| 3     | Planned        | After Phase 2                              |
| 4     | Planned         | Can partially overlap with later phases    |
| 5     | Ongoing         | This document is the living artifact       |

---

## Logo Reference (locked)

**Option 3 — The Contradiction Ring**  
Minimalist abstract mark: rounded hexagon containing two parallel strokes that form a continuous Möbius-like loop. Encodes the core ResearchOne claim: contradictions are preserved and bridged, not collapsed into a single consensus narrative.

All future branding work should treat this as the canonical mark.

---

*Agents: when implementing any phase, update the status table above and add a short retrospective note under `docs/retrospectives/` if the phase surfaces new architectural decisions.*
