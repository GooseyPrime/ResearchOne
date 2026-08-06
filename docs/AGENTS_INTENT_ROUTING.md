# Agent invariants — intent routing & epistemic posture

**Binding for agents** working on planning, orchestration, or public copy.  
Companion to [`AGENTS.md`](../AGENTS.md) and [`HOW_RESEARCHONE_RESEARCHES.md`](HOW_RESEARCHONE_RESEARCHES.md).  
**Last updated:** 2026-08-06

1. **Every `IntentId` maps to a real orchestration profile** — no `wave5_placeholder_*` profile ids. Taxonomy `defaultOrchestrationProfile` equals the intent id; plan/prompt stubs may use the display name `canonical_profile` for unresolved model JSON.
2. **Plan gate is visible** — users see intent, confidence, and posture (neutral / challenge / steelman) before retrieval when confirmation is required.
3. **PolicyOne DNA is engine behavior**, not public brand identity. Investigation / adjudication / story_verification / position_brief paths may use challenge or steelman postures; public marketing stays professional and multi-intent.
4. **Public copy neutrality** — do not promote fringe, conspiracy, UAP, or adversarial-identity framing on marketing or Tier A surfaces. See `docs/marketing/tier-a-banned-jargon.txt` and Rule 36.
5. **Stage vocabulary for live UI** — Planning → Discovery → Retrieval → Reasoning → Challenge → Synthesis → Verification (`docs/HOW_RESEARCHONE_RESEARCHES.md`).
6. **Doc/code parity** — changes to posture or pipeline behavior must update `howResearchOneThinks.ts`, `howYourReportIsMade.ts`, Guide/Methodology pages, and this file in the same change set when user-visible.
