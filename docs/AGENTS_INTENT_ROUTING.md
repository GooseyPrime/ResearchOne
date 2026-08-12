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
7. **Explicit user intent is binding and must survive markdown** — a declared `Primary research intent:` wins over lexical triggers and the LLM classifier. The captured token must be normalized (markdown emphasis, backticks, quotes, trailing punctuation) before alias lookup. Users write `**opportunity_discovery**`; that must resolve. See Rule 37 R-A / R-G.
8. **The user can change the resolved type at plan review** — intent, confidence, and posture are shown at the plan gate and are user-overridable before retrieval begins. Classification is a proposal, not a verdict.
9. **Corpus is sealed by default** — retrieval serves citable evidence only from topic partitions that have cleared independence and density thresholds; everything else is non-citable background and live discovery carries the run. See Rule 40.
10. **Report type never justifies non-delivery** — for non-adjudicative intents, imperfect evidence is labeled, not used to abort the deliverable. PolicyOne remains at full strength for adjudication, investigation, story_verification, and position_brief.

**Active work order:** [`WO-Z-REPORT-TYPE-FIDELITY.md`](WO-Z-REPORT-TYPE-FIDELITY.md) (OPEN).
