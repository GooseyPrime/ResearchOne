# ResearchOne Refinement Phased Plan

**Status:** Living document for all agents and contributors.  
**Last updated:** 2026-08-05  
**Logo decision:** Option 3 — The Contradiction Ring (Möbius-style parallel strokes in a rounded hexagon). Symbolizes preservation of contradiction without forced collapse; bridges consensus and anomaly.

This plan implements the recommendations from the August 2026 platform audit. It preserves the original PolicyOne / adversarial research DNA (reasoning-first, assume fringe claims may contain truth, seek supporting evidence + outlier connections, refuse silent debunking) while making the system correctly route *any* user research intent through the multi-agent pipeline.

**Public surfaces** must present ResearchOne as a neutral, professional multi-agent research platform. Internal engine behavior (PolicyOne, investigation paths, contested-topic handling) remains; public marketing and guidance copy must not brand the product as fringe, conspiracy, UAP, or adversarial-identity focused (see PR #192).

---

## Guiding Principles

1. **Epistemic transparency** — Users must see *how* ResearchOne will think about their query (intent, skeptic/steelman posture, stages).
2. **PolicyOne DNA is non-negotiable** for investigation / adjudication / story_verification / position_brief paths (engine behavior).
3. **Intent-driven orchestration** — Every IntentId maps to a concrete OrchestrationProfile (agentsToRun/Skip, skepticMode, steelmanMode).
4. **No silent defaults** that hide investigation capability or force consensus-only answers in the pipeline.
5. **Human-readable everything** — Stage labels, posture labels, and guidance use plain, professional language on public surfaces.

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

**Status: Complete (PR #188 merged)**

---

## Phase 2 — Epistemic Transparency & User Guidance

**Goal:** Make research posture understandable and controllable by users.

### Deliverables
- [x] Create `frontend/src/content/howResearchOneThinks.ts`
- [x] `PlanConfirmationPanel.tsx` — posture family badge, intent help, expandable guidance, intent override
- [x] Methodology / Guide / Onboarding surfaces
- [x] Marketing copy updates (later neutralized in PR #192)

**Status: Complete (PR #190 merged)**

---

## Phase 3 — Visual & Branding Alignment

**Goal:** Align visual identity with the selected logo mark and professional public positioning.

### Deliverables
- [x] Integrate Logo Option 3 mark in R1TopRail header (public aria-label: ResearchOne logo)
- [x] Add favicon.svg with the locked mark geometry
- [x] Update AnimatedPipelineHero — dual-stroke bridge motif at Reasoner→Skeptic turn
- [x] Dark-mode polish: PlanConfirmationPanel, LiveStatusBanner, dossier status badges
- [x] Public copy neutrality pass (PR #192) — professional research language on marketing/guidance surfaces
- [ ] OG image + remaining public marketing asset parity (optional polish)

**Status: Complete (PR #191 + #192 on main)**

---

## Phase 4 — Orchestration Hardening

**Goal:** Replace placeholders and make routing reliable.

### Deliverables
- [x] Retire `wave5_placeholder_*` — taxonomy `defaultOrchestrationProfile` is the intent id; plan/prompt stubs use `canonical_profile`
- [x] Every IntentId has a production `ORCHESTRATION_PROFILES` entry; parity tests enforce taxonomy ↔ profile ↔ template
- [x] Lexical classifier hardened (specificity ranks, weak single-hits defer to LLM)
- [x] Steelman wired via `runSteelmanPass` when `steelmanMode !== 'off'`
- [x] Runtime unification via `mergePlanPayloadWithCanonicalProfile` / `resolveOrchestrationProfileFromJob`
- [x] Frontend lint: Rules of Hooks fixed in `MonitorToggle.tsx`

**Status: Complete**

---

## Phase 5 — Agent Guidance, Docs & Long-term Maintainability

**Goal:** Make the system self-documenting for both human and AI agents.

### Deliverables
- Keep this file (`docs/REFINEMENT_PHASED_PLAN.md`) as the single source of truth
- Update `AGENTS.md` / governance docs with PolicyOne posture rules and intent routing invariants
- User-facing "How ResearchOne researches" guide (professional tone; no fringe marketing)
- Telemetry / cost notes for new paths
- Regression tests for intent parity and posture display

---

## Current Status

| Phase | Status          | Notes                                      |
|-------|-----------------|--------------------------------------------|
| 1     | Complete        | PR #188 merged                            |
| 2     | Complete        | PR #190 merged                            |
| 3     | Complete        | PR #191 branding + PR #192 public neutrality on main |
| 4     | Complete        | Placeholders retired; classifier + hooks fixed on main |
| 5     | Ongoing         | This document is the living artifact       |

---

## Logo Reference (locked)

**Option 3 — The Contradiction Ring** (internal design name)  
Minimalist abstract mark: rounded hexagon containing two parallel strokes that form a continuous Möbius-like loop. Public UI should label the mark as **ResearchOne logo**; do not require users to learn internal symbolism.

All future branding work should treat this geometry as the canonical mark.

---

*Agents: when implementing any phase, update the status table above and add a short retrospective note under `docs/retrospectives/` if the phase surfaces new architectural decisions.*
