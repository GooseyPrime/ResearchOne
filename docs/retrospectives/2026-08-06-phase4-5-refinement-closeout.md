# Retrospective — Phase 4–5 refinement closeout (2026-08-06)

## What shipped

- Phase 4 orchestration hardening on `main`: taxonomy profile ids, `canonical_profile` plan/prompt stubs, full `planJson.ts` restore after PLACEHOLDER/SEE_FILE corruption, MonitorToggle Rules-of-Hooks fix.
- Phase 5 documentation: `docs/HOW_RESEARCHONE_RESEARCHES.md`, AGENTS intent/posture invariants, phased plan status table.
- Phase 3 polish: social OG asset (`og-image.svg`) referenced by `marketingDocumentHead.ts`.

## Process failures (do not repeat)

- Empty Copilot PRs (#193, #194) with only “Initial plan” commits were merged or left open without file diffs. **Acceptance requires a non-empty Files tab.**
- Accidental overwrite of `planJson.ts` with sentinel text broke production planning until direct restore commits.

## Copy / positioning

- Public surfaces remain neutral multi-intent research platform language.
- Engine retains investigation/challenge capabilities without marketing the product as fringe or debunking-first.

## Follow-ups

- Telemetry/cost notes for intent paths.
- Optional regression tests for posture badges at the plan gate.
