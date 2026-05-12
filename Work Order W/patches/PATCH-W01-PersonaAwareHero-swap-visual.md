# PATCH W01 — `PersonaAwareHero.tsx`: swap `HeroPipelineVisual` for `AnimatedPipelineHero`

**File:** `frontend/src/components/landing/persona/PersonaAwareHero.tsx`
**Why:** Mount the animated pipeline in the hero. Per Rule 27 I-5 the
animated component reads `data-persona` from the section it's inside —
`PersonaAwareHero`'s `<section data-persona={persona}>` already
exposes this attribute (from WO-V), so the composition contract works
the moment we swap the import.

**Behavioral guarantee:** When `useReducedMotion()` returns true,
`AnimatedPipelineHero` renders the EXACT same `<HeroPipelineVisual />`
that this file currently mounts directly. Per Rule 27 I-1, the
reduced-motion code path is byte-identical to the pre-patch behavior.

For mobile viewports (<768px), `AnimatedPipelineHero` also renders
the static `<HeroPipelineVisual />` because the 10-stage S-curve does
not survive narrow viewports gracefully. The static layout already
handles mobile well — no need to reinvent it.

---

## Step 1 — Imports

Find the existing import (line 3):

```ts
import HeroPipelineVisual from '../HeroPipelineVisual';
```

**Replace with:**

```ts
import AnimatedPipelineHero from '../visual/AnimatedPipelineHero';
```

(Note: `HeroPipelineVisual` is no longer imported HERE because
`AnimatedPipelineHero` imports and uses it internally for both the
reduced-motion fallback and the mobile path. The static component
file itself is NOT deleted — per Rule 27 I-2.)

## Step 2 — Render swap

Find the existing usage near the bottom of the JSX (currently the
final element in the section):

```tsx
        )}
      </div>
      <HeroPipelineVisual />
    </section>
  );
}
```

**Replace `<HeroPipelineVisual />` with `<AnimatedPipelineHero />`:**

```tsx
        )}
      </div>
      <AnimatedPipelineHero />
    </section>
  );
}
```

No props needed — `AnimatedPipelineHero` reads `data-persona` from
the wrapping `<section data-persona={persona}>` that `PersonaAwareHero`
already sets (WO-V PATCH-V03). The persona attribute flows
automatically via DOM lookup.

## Step 3 — Verify

```bash
cd frontend
npx tsc --noEmit
npm run build
npx vitest run AnimatedPipelineHero
npx vitest run PersonaAwareHero
```

The existing `PersonaAwareHero` tests must still pass — they assert
the eyebrow / headline / subhead / CTA text, none of which we touched.

Manual smoke:

1. Open `/` with `prefers-reduced-motion: reduce` (DevTools → Rendering
   → "Emulate CSS media feature"). Confirm the page renders the
   existing static pipeline — no movement.
2. Disable that emulation. Reload `/`. Confirm the beams animate
   along the S-curve, the Skeptic node has a noticeably brighter ring
   and a soft glow.
3. Scroll the pipeline off-screen, watch DevTools Performance — beam
   animation should pause (IntersectionObserver gate, Rule 27 I-6).
4. Visit `/?p=osint` — beams shift to the cooler blue OSINT palette,
   Skeptic ring goes near-white.
5. Visit `/?p=uap` — beams shift to violet/magenta.
6. Resize to <768px — animated version is hidden, static mobile
   chain renders.

## Rollback

One-line: change `<AnimatedPipelineHero />` back to
`<HeroPipelineVisual />` and add the import back. Animation modules
remain in the codebase, off-render.
