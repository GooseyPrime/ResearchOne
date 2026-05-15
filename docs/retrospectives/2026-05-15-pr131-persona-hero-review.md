# 2026-05-15 — PR #131 follow-up (Copilot)

## Thread summary

GitHub Copilot (`copilot-pull-request-reviewer`) left **two** inline review comments on the initial merge commit. **No Codex bot comments** appeared on the same PR review thread at the time of follow-up.

## Findings

1. **Invalid `theme()` token in arbitrary radial gradient** (Copilot): `theme(colors.slate.800/30)` is not a valid Tailwind `theme()` lookup; the bundler may emit a literal `theme(...)` string and the hero depth wash would not render.
2. **Opaque boolean assertion in marketing hardening test** (Copilot): `expect(html.includes(...) || ...).toBe(true)` produces a generic failure message when the pipeline markers drift; prefer a single `toMatch` over the allowed `data-testid` values.

## Resolution

- `PersonaAwareHero.tsx`: Replaced the gradient stop with `rgba(30,41,59,0.3)` (Tailwind `slate-800` / `#1e293b` at 30% opacity) inside the arbitrary `bg-[radial-gradient(...)]` value, avoiding invalid `theme(colors.slate.800/30)` lookups and avoiding `/` inside the arbitrary segment (which can truncate Tailwind utilities).
- `marketingHardening.test.tsx`: Assert with  
  `expect(html).toMatch(/data-testid="(?:pipeline-animated|pipeline-mobile-static|static-pipeline-fallback)"/)`  
  so Vitest prints the received HTML substring on failure.

## Codex

No Codex-authored review items were present on PR #131 for this pass; nothing to reconcile under that label.

---

## 2026-05-16 — Product correction after merge

**Issue:** Landing persona hero regressed to `AnimatedPipelineHero` / `HeroPipelineVisual` instead of keeping the marquee **`PipelineSchematic`**; slate-only shell read as “half” a restyle because single-layer Tailwind arbitrary gradients sat weakly on top of `LabNotebookCanvas` and were easy to lose to parsing/stacking.

**Actions (follow-up branch):**

- Restore **`PipelineSchematic`** in `PersonaAwareHero` inside a **taller responsive frame** (`min-h` clamps + rounded panel + border + inset highlight) with responsive **scale** (no `overflow-y-auto` scroll trap on the desktop wrapper).
- Apply **depth** via **`style={{ backgroundImage: … }}`** on an absolute layer (stacked radial + vertical linear wash) so the 3D-style lighting is deterministic in React/Tailwind composition.
- **Remove** unused WO-W implementation from app source: `AnimatedPipelineHero.tsx`, `pipelineBeams.tsx`, `pipelineLayout.ts`, `personaBeamPalettes.ts`, and `AnimatedPipelineHero.test.tsx`.
- Marketing hardening test again keys off `data-testid="pipeline-skeptic-loop-path"` from `PipelineSchematic`.
- Docs: `governance.md` / `wave-4-evidence-vocabulary-scope.md` out-of-scope paths updated from deleted `pipelineLayout.ts` to **`pipelineSchematicData.ts`**; `LabNotebookCanvas` / `heroPipelineAria` comments de-WO-W’d; `AGENTS.md` example generalized.
