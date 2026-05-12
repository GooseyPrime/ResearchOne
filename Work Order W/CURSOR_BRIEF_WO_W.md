# Cursor Brief — WO-W Animated Multi-Agent Pipeline Hero

**Read this first.** Companion to `CURSOR_BRIEF.md` (WO-U) and
`CURSOR_BRIEF_WO_V.md` (WO-V). WO-W has one **hard dependency on WO-V**
— the `<section data-persona={persona}>` set by `PersonaAwareHero`
is the persona signal WO-W reads via DOM. Land WO-V first.

---

## Goal in one sentence

Replace the static 4-phase pipeline diagram on the landing hero with
an animated 10-stage flow — directed beams of light pulsing along an
S-curve between agent nodes, persona-tuned color palettes (WO-V →
WO-W contract), and Skeptic visibly emphasized — while preserving
the existing static visual byte-identically as the reduced-motion
fallback AND the mobile fallback.

---

## Reading order

1. `.cursor/rules/00-pre-commit-review.mdc` — master checklist (existing).
2. `.cursor/rules/26-landing-persona-and-visual.mdc` — WO-V's rule,
   defines the composition contract this WO consumes (existing or
   shipped with WO-V).
3. `.cursor/rules/27-animated-pipeline-hero.mdc` — this WO's ten
   invariants. **NEW** in this package.
4. `docs/ResearchOne - Work Order W.md` — the formal WO.
   **NEW** in this package.
5. Existing files to read end-to-end:
   - `frontend/src/components/landing/HeroPipelineVisual.tsx` (93
     lines — the static baseline this WO does NOT edit and DOES import)
   - `frontend/src/components/landing/persona/PersonaAwareHero.tsx`
     (the parent that exposes `data-persona`)
   - `frontend/src/components/landing/persona/personaResolver.ts`
     (the `PersonaId` type WO-W reuses as a leaf import)

---

## Write order

### Phase A — Rule + WO doc

1. `.cursor/rules/27-animated-pipeline-hero.mdc` → `.cursor/rules/`.
2. `docs/ResearchOne - Work Order W.md` → `docs/`.

### Phase B — Visual modules (no behavioral change yet)

3. `frontend/src/components/landing/visual/pipelineLayout.ts` — copy
   as-is. **Cursor: read this file end-to-end first.** It contains the
   canonical 10-stage labels — confirm they match the labels in
   `HeroPipelineVisual.tsx`. If they drift, the marketing-tripwire
   test in step 7 will fail.
4. `frontend/src/components/landing/visual/personaBeamPalettes.ts`
   — copy as-is.
5. `frontend/src/components/landing/visual/pipelineBeams.tsx` — copy
   as-is.
6. `frontend/src/components/landing/visual/AnimatedPipelineHero.tsx`
   — copy as-is.
7. `frontend/src/__tests__/landing/AnimatedPipelineHero.test.tsx` —
   copy and run `npx vitest run AnimatedPipelineHero`. All 13
   assertions must pass with the modules in place. Mentally revert the
   `if (reducedMotion)` early return — the first test must fail. This
   is the load-bearing Rule 27 I-10 check.

After Phase B: still no visible change. The animated component exists
but `PersonaAwareHero` doesn't use it.

### Phase C — Wire up

8. PATCH-W01 — `PersonaAwareHero.tsx`. Two-line swap: import
   `AnimatedPipelineHero` instead of `HeroPipelineVisual`, render
   `<AnimatedPipelineHero />` instead of `<HeroPipelineVisual />`.
9. After deploy:
   - Visit `/` with system "Reduce Motion" enabled → static visual.
   - Visit `/` normally on desktop → animated beams cycle through 10
     stages, Skeptic glows.
   - Visit `/?p=uap` → violet/magenta beam palette, rose Skeptic ring.
   - Resize to <768px → static mobile chain.
   - Scroll the pipeline off-screen → beams pause (DevTools
     Performance shows JS RAF drop to ~0).

---

## Pre-commit grep checks (Rule 27 invariants)

```bash
# I-2 — static visual is imported, not duplicated
grep -rn "HeroPipelineVisual" frontend/src --include='*.tsx' \
  | grep -v __tests__
# Expected hits:
#   frontend/src/components/landing/HeroPipelineVisual.tsx (definition)
#   frontend/src/components/landing/visual/AnimatedPipelineHero.tsx (1 import + 2 renders)
# After PATCH-W01: PersonaAwareHero.tsx no longer imports it directly.

# I-7 — no banned filters in the animation modules
grep -rn "filter:\s*drop-shadow\|filter:\s*blur\|<filter\b" \
  frontend/src/components/landing/visual/
# Expected: zero hits

# I-1 — reduced motion is consulted
grep -n "useReducedMotion" \
  frontend/src/components/landing/visual/AnimatedPipelineHero.tsx
# Expected: at least one hit
```

---

## Acceptance sanity check (post-Phase C)

| Condition | Expected behavior |
|---|---|
| `prefers-reduced-motion: reduce` on | Static `HeroPipelineVisual` renders. Zero motion. |
| Desktop, motion on, `/` | Animated beams cycle, Skeptic glows (cyan default palette). |
| Desktop, motion on, `/?p=osint` | Cool blue palette, near-white Skeptic ring. |
| Desktop, motion on, `/?p=uap` | Violet/magenta palette, rose Skeptic ring. |
| Desktop, motion on, `/?p=academic` | Teal palette, amber Skeptic ring. |
| Desktop, motion on, `/?p=patent` | Amber palette, green Skeptic ring. |
| Mobile (<768px) | Static vertical chain — animation suppressed. |
| Scroll pipeline off-screen | Beam loop pauses (IntersectionObserver). |
| Scroll back into view | Beams resume. |
| DevTools deuteranopia/protanopia/tritanopia | Beams remain perceptible (brightness contrast). |

---

## What this WO explicitly does NOT do

- **Does NOT add a new npm package.** `framer-motion` is already
  installed at ^11.15.0. The Aceternity UI beam pattern is
  copy-paste, not a dep — we bake it directly.
- **Does NOT edit `HeroPipelineVisual.tsx`.** Per Rule 27 I-2. It is
  imported and re-rendered, never modified.
- **Does NOT modify the 10 canonical stage names.** Per Rule 27 I-3.
  Marketing depends on these strings.
- **Does NOT use `filter: drop-shadow`, `filter: blur`, or
  `<feGaussianBlur>`.** Per Rule 27 I-7. The glow effect is a
  stacked wider stroke layer.
- **Does NOT animate on mobile.** Below the `md:` breakpoint (768px)
  the static visual renders. The S-curve does not survive narrow
  viewports gracefully and the battery cost is not worth it on
  phones.
- **Does NOT animate when off-screen.** IntersectionObserver gate at
  25% visibility threshold. Rule 27 I-6.
- **Does NOT add a new persona.** Adding a fifth or sixth tribe is a
  separate decision that touches WO-V (`personaResolver`,
  `personaContent`), WO-W (`personaBeamPalettes`), and the WO-U cost
  dashboard (which has its own phase color map). All four must
  change in coordinated PRs.

---

## Companion Work Orders

| WO | Status | Composition with WO-W |
|---|---|---|
| **WO-U** | Cost sidecar | Fully independent. No touch points. |
| **WO-V** | Persona-adaptive landing + lab notebook | **Hard dependency.** WO-V's `PersonaAwareHero` sets `data-persona` on its section; WO-W reads it via DOM `closest('[data-persona]')`. Without WO-V, the persona detection always falls back to 'default'. |
| **WO-W** | THIS WO | — |
| **WO-X** | Academic formatting engine | No touch with WO-W. |
