# How ResearchOne researches

**Audience:** site users, support, and internal agents.  
**Tone:** professional, neutral, multi-intent research platform.  
**Last updated:** 2026-08-06

This document is the **canonical** plain-language description of the research pipeline.  
Public UI copy in `frontend/src/content/howResearchOneThinks.ts` and  
`frontend/src/content/howYourReportIsMade.ts` must stay consistent with this file.

---

## What users experience

1. **Ask** — Describe the research goal in EZ Research or Research Lab.
2. **Plan gate** — Review detected **intent**, **epistemic posture** (neutral / challenge / formulation enhancement), scope, sources, and expected depth/cost. Confirm, refine, override intent, or cancel.
3. **Run** — Multi-agent pipeline executes only after confirmation (unless auto-confirm is enabled for the account).
4. **Report** — Cited dossier with sources, uncertainty, and preserved source disagreements when they matter.
5. **Revise / monitor** — Optional revision, Living Report monitoring, or Reverse-Citation Watch.

---

## Pipeline vocabulary (live progress)

User-facing progress labels map to:

| Stage label | Meaning |
|-------------|---------|
| Planning | Intent classification, research brief, plan generation |
| Discovery | Topic framing and source strategy |
| Retrieval | Source search and ranking |
| Reasoning | Draft findings grounded in sources |
| Challenge | Optional skeptic / challenge pass (when posture warrants it) |
| Synthesis | Integrate findings into the report structure |
| Verification | Citation binding and final checks |

Marketing illustrations (e.g. 10-stage schematic on the landing page) are **pedagogical expansions** of the same pipeline—not a second product contract.

---

## Research postures

| Posture | When it appears | What users should expect |
|---------|-----------------|---------------------------|
| **Neutral** | Factual report, how-to, reference lookup, many surveys | Retrieve → synthesize → verify; no dedicated challenge gate |
| **Challenge** | Adjudication, investigation, story verification, and other gate paths | Dedicated challenge step pressure-tests draft conclusions |
| **Formulation enhancement** | Position brief (and related products) | Strongest-case construction for a stated position |

Posture is selected from the **orchestration profile** tied to the detected (or overridden) intent—not from marketing topic lists.

---

## Intent routing

ResearchOne classifies each query into one of 16+ intents (see backend `intentTaxonomy.ts` and frontend intent labels). The intent selects:

- which agents run or skip
- skepticMode / steelmanMode
- document shape and deliverable expectations

Users can correct a misclassification at the plan gate via **“I meant a different research goal”** without removing the confirmation gate.

---

## Source disagreements

When sources genuinely conflict, disagreements remain visible in the report with attribution. The product does **not** silently collapse conflict into false consensus.

---

## Public positioning (non-negotiable)

- ResearchOne is a **general multi-agent research platform**.
- Public marketing and guides must **not** brand the product as fringe, conspiracy, UAP-focused, or “debunking-first.”
- Engine behavior for investigation / verification paths remains capable and balanced; it is **not** advertised as the product identity.

Banned public jargon is enforced by CI against the Tier A manifest (`docs/marketing/tier-a-banned-jargon.txt`).

---

## Related surfaces

| Surface | Path / module |
|---------|----------------|
| Methodology (public) | `/methodology` → `MethodologyPage.tsx` |
| In-app guide | `/app/guide` → `GuidePage.tsx` |
| Plan gate copy | `howResearchOneThinks.ts` |
| Report intro steps | `howYourReportIsMade.ts` |
| Live status | `researchLiveStatus.ts` |
| Agent rules | `AGENTS.md`, Rule 20 (PolicyOne), Rule 36 (two-audience copy) |
