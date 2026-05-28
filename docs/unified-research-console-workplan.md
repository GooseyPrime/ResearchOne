# Unified research console workplan

## Problem

PR #144 replaced `/app/research` with `ResearchDashboard` (Sticklight hub), breaking:

- Unified Standard / Deep experience
- `?engine=v2` deep link (still showed hub)
- Inline `attachRun` + plan gate (hub navigated to `/app/run/:id`)

## Solution (this PR)

- [`UnifiedResearchConsole`](../frontend/src/pages/UnifiedResearchConsole.tsx) — mode toggle + remounted `ResearchStandardPage` / `ResearchDeepPage`
- [`ResearchEngineModeToggle`](../frontend/src/components/research/ResearchEngineModeToggle.tsx) — descriptive copy per method
- Free-tier upsell via [`DeepResearchUpgradeModal`](../frontend/src/components/research/DeepResearchUpgradeModal.tsx) + [`useCanAccessDeepResearch`](../frontend/src/hooks/useCanAccessDeepResearch.ts)
- Skeptic persona on Deep via [`SkepticPersonaSelector`](../frontend/src/components/research/SkepticPersonaSelector.tsx) (`supplemental` field → V2 skeptic / red-team pass)

## State reset on mode toggle

Child pages remount with `key="research-deep-console"` / `key="research-standard-console"` so Deep-only state (files, objective, persona) does not leak into Standard submits.

## Acceptance criteria

- [ ] `/app/research` shows full console (not `ResearchDashboard`)
- [ ] Standard submit omits `engineVersion: 'v2'`; Deep sends `engineVersion: 'v2'`
- [ ] No navigate-away on submit; inline trace + plan gate
- [ ] `?engine=v2` and `/app/research-v2` still select Deep mode
- [ ] `?runId=…#plan` still routes to plan review pages
- [ ] Free `free_demo` users see upgrade modal when selecting Deep (not 403 after filling form)

## PR #149 review fixes (Codex / Copilot)

- Cross-mode recent-run open: shell `queueRunHandoff` / `consumeRunHandoff` + `useResearchShellOpenRun`.
- Deep hydrate: reset `skepticPersona` on open-request; split preset persona from stored supplemental.
- Deep tier gate: include `/auth/me` loading in `tierGateUnknown` (admin on `free_demo`).
- Custom persona: textarea when “Custom Persona” is selected.

## Follow-up (not this PR)

Single-sheet form with greyed inactive sections (merge Deep + Standard UI into one component).
