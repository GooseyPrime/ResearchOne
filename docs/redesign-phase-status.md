# ResearchOne Redesign — Phase Status

Tracks implementation progress against the plan in
[`ResearchOne_All_Purpose_Deep_Research_Redesign_Report.md`](../ResearchOne_All_Purpose_Deep_Research_Redesign_Report.md).

**Each PR that closes a redesign stage must update this file** — see
[`.cursor/rules/39-redesign-phase-checklist.mdc`](../.cursor/rules/39-redesign-phase-checklist.mdc).

---

## Phase A — correctness patch ✅ Complete (PR #175)

- [x] Remove universal falsification from planner and verifier
- [x] Make final report sections intent-driven (`ADJUDICATIVE_SECTION_PLAN`, `DESCRIPTIVE_SECTION_PLAN`, routing)
- [x] Pass confirmed intent/template into synthesis
- [x] Add regression fixture for the attached failure prompt
- [x] Intent-aware consistency checks in verifier

---

## Phase B — ResearchBrief and contract audit ✅ Complete (PR #176)

- [x] Introduce primary/secondary intents and requested-artifact extraction
- [x] Exact-count and required-field extraction in ResearchBrief
- [x] Final Deliverable Contract Auditor wired into pipeline
- [x] Intent-specific verifier rubrics
- [x] `INTENT_IDS` completeness and verifier fallback fixes

---

## Phase C — EZ Research ✅ Complete (PR #177)

- [x] Simplified EZ Research intake surface (mode tab split)
- [x] Clarification chat and `buildClarifyingQuestions` utility
- [x] Plain-language plan preview
- [x] Auto-routing: depth, posture, agents, sources, output format
- [x] Current UI preserved as Research Lab
- [x] ARIA toggle group, `RequestedArtifact` shared type, locale sort
- [x] `humanizeIdentifier` util extracted; `initialMode` surface reset

---

## Phase D — specialist expansion ✅ Complete (current PR)

### Completed in this PR

- [x] Typed `AgentCapability` registry (`agentCapabilityRegistry.ts`) with 5 core + specialist roles
- [x] `selectAgentsForBrief(primaryIntent, secondaryIntent)` — intent-driven agent selection
- [x] `SPECIALIST_AGENT_IDS` single source of truth (backend + frontend)
- [x] Market / opportunity agents: `market_scout`, `competitor_mapper`, `demand_signal_analyst`, `feasibility_architect`
- [x] Story / timeline agents: `story_verifier`, `timeline_reconstructor`
- [x] All 6 specialist roles threaded through: `REASONING_MODEL_ROLES` → `defaultModels` → `config/index` env overrides → `modelRuntime` → `researchEnsemblePresets` → `openrouterService` (prompts, temperatures, max_tokens) → `costSidecar.rolePhaseFor()`
- [x] Adaptive orchestration: `mergePlanPayloadWithCanonicalProfile` merges selected specialist IDs into `agentsWillRun`
- [x] Plan preview — "Agent team" block with `agentDisplayDescriptions.ts` (plain-language names/descriptions)
- [x] Hero adaptive visualization: `SPECIALIST_PIPELINE_STAGES`, `resolveNodeOpacity`, `agentsToRun` prop on `AnimatedPipelineHero`
- [x] Backend unit tests for registry selection logic (dedup, intent routing, adjudication core-only)
- [x] Frontend tests for hero opacity logic and agent team display
- [x] Actual specialist execution wiring (selected specialist agents are invoked, checkpointed, and surfaced to synthesis metadata)
- [x] Data-analysis and quantitative-quality specialist agents (`data_analysis_specialist`, `quantitative_quality_auditor`)
- [x] Additional source connectors and provider specialization for specialist roles (OpenAlex, Crossref, arXiv, PMC, USPTO, ClinicalTrials, Parallel)

---

## Phase E — evaluation and optimization 🔄 In progress

- [x] Build the golden-prompt suite (one report per intent × depth combination baseline + coverage tests)
- [ ] A/B test intake questions and report templates
- [ ] Tune agent-selection rules for quality, cost, and latency
- [ ] Consider fine-tuning after sufficient labeled routing data is collected

---

## Definition of done (from §13 of redesign report)

Reproduced here for quick reference:

> A user submitting "I need to evaluate whether the market for X exists and who the competitors are" gets a structured **Opportunity Discovery** report — not a falsification analysis. A user submitting "Did company X really do Y?" gets a **Story Verification** report with confidence scoring. A user submitting "What are the best practices for Z?" gets an **Informational** report with clearly labeled recommendations. The product's own marketing copy accurately reflects that the tool serves all three audiences.
