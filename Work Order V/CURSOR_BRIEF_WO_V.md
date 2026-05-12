# Cursor Brief — WO-V Lab Notebook + Persona-Adaptive Landing

**Read this first.** Companion to `CURSOR_BRIEF.md` (which is for
WO-U). WO-V is independent — it can land on its own schedule. WO-V
provides a `data-persona` composition surface that WO-W will later
consume, but until WO-W ships, WO-V works fine standalone.

---

## Goal in one sentence

Replace the static landing-page visual with a CSS-only lab-notebook
aesthetic (muted ruled paper on near-black ground, off-white body,
+100 weight bump) and ship a persona-adaptive hero that swaps copy
based on inbound signals (UTM / referrer / query param / pathname)
across five tribes (OSINT / UAP / academic / patent / default) —
without breaking the existing default copy for any visitor that
doesn't carry a persona signal.

---

## Reading order

1. `.cursor/rules/26-landing-persona-and-visual.mdc` — the ten
   invariants. **NEW** — in this package.
2. `docs/WO-V_VISUAL_DESIGN_NOTES.md` — why each color and weight
   value is what it is. Surface to designers / stakeholders.
   **NEW** — in this package.
3. `docs/ResearchOne - Work Order V.md` — the formal WO. **NEW**.
4. Existing files to read end-to-end:
   - `frontend/src/index.css` (152 lines)
   - `frontend/tailwind.config.js` (80 lines)
   - `frontend/src/pages/LandingPage.tsx` (247 lines)
   - `frontend/src/components/landing/Hero.tsx` (28 lines — the
     canonical copy source the default persona variant locks to)

---

## Write order (apply in EXACTLY this order)

### Phase A — CSS + tokens (no visual change to live pages)

1. **`.cursor/rules/26-landing-persona-and-visual.mdc`** → `.cursor/rules/`.
2. **`docs/ResearchOne - Work Order V.md`** → `docs/`.
3. **`docs/WO-V_VISUAL_DESIGN_NOTES.md`** → `docs/`.
4. **PATCH-V01** — `frontend/src/index.css`. Adds 8 CSS custom
   properties to `:root` and the `.lab-notebook-canvas` class plus
   mobile breakpoint and `.no-ruling` opt-out. Strictly additive.
5. **PATCH-V02 (optional)** — `frontend/tailwind.config.js`. Adds
   `colors.notebook.*` namespace. Convenience for utility classes.

After Phase A: live pages look identical to today. Migration safe.

### Phase B — Component primitives (still no visual change)

6. **`frontend/src/components/landing/visual/labNotebookTokens.ts`**
   — copy as-is.
7. **`frontend/src/components/landing/visual/LabNotebookCanvas.tsx`**
   — copy as-is.
8. **`frontend/src/components/landing/persona/personaResolver.ts`**
   — copy as-is.
9. **`frontend/src/components/landing/persona/personaContent.ts`**
   — copy as-is. **Cursor: open this file alongside the existing
   `frontend/src/components/landing/Hero.tsx` and verify the `default`
   variant copy matches Hero verbatim. If it differs, the test in
   step 11 will fail — that's the load-bearing tripwire for
   Rule 26 I-3.**
10. **`frontend/src/components/landing/persona/PersonaAwareHero.tsx`**
    — copy as-is.
11. **`frontend/src/__tests__/landing/personaResolver.test.ts`** — copy
    and run `npx vitest run personaResolver`. All assertions must pass
    with the resolver in place AND fail when the relevant code path
    is reverted. Verify at least three `// REVERT-CHECK:` comments
    manually.
12. **`frontend/src/__tests__/landing/PersonaAwareHero.test.tsx`** —
    copy and run `npx vitest run PersonaAwareHero`. The "default state
    matches existing Hero copy" test must pass — if it fails, your
    `personaContent.ts:default` drifts from `Hero.tsx`.

After Phase B: still no visual change. All new components exist but
LandingPage doesn't use them.

### Phase C — Wire it up (LIVE visual change)

13. **PATCH-V03** — `frontend/src/pages/LandingPage.tsx`. Two import
    changes and one wrapper swap. After this, refresh `/` in a browser
    — you should see the lab-notebook background and the default
    Hero copy unchanged.
14. Smoke test the persona variants by visiting:
    - `/?p=osint` → OSINT hero
    - `/?p=uap` → UAP hero
    - `/?p=academic` → academic hero
    - `/?p=patent` → patent hero
    - `/?p=garbage` → default hero (silent fallthrough)
    - `/` (incognito tab, no referrer, no params) → default hero
15. Open DevTools Network during a visit to `/?p=osint`. Confirm zero
    outbound HTTP from the resolver (Rule 26 I-1).

### Phase D (optional, defer 2 weeks) — Backend analytics

16. **PATCH-V04** — migration `031_landing_persona_analytics.sql`,
    route `backend/src/api/routes/landing.ts`, mount in `app.ts`,
    optional admin rollup endpoint in `admin.ts`.
17. Wire the frontend callback in `LandingPage.tsx`:
    ```tsx
    <PersonaAwareHero
      onPersonaResolved={(persona, path) => {
        api.post('/landing/persona-event', { persona, path, eventType: 'view' })
          .catch(() => {});
      }}
    />
    ```
18. After one week of live traffic, query the admin rollup endpoint
    and verify the persona distribution makes sense vs. your inbound
    mix.

---

## Pre-commit grep checks (Rule 26 invariants)

```bash
# I-1 — resolver makes no network calls
grep -rn "fetch\|XMLHttpRequest\|axios" frontend/src/components/landing/persona/
# Expected: zero hits

# I-1 — document.referrer is read in exactly one place
grep -rn "document.referrer" frontend/src/components/landing/persona/
# Expected: at most one hit, in personaResolver.ts

# I-2 — backend writer validates persona against an enum
grep -n "VALID_PERSONAS\|persona.*CHECK.*IN" \
  backend/src/api/routes/landing.ts \
  backend/src/db/migrations/031_landing_persona_analytics.sql
# Expected: both files match. No free-text writes.

# I-3 — default content matches Hero.tsx
# (manual: open both files side-by-side and diff the copy)

# I-5 — no image/SVG/base64 in the lab-notebook visual modules
grep -rn "url(\|base64\|<svg" frontend/src/components/landing/visual/
# Expected: zero hits
```

---

## Acceptance sanity check (post-Phase C)

Visit each in a fresh incognito tab (so sessionStorage is clean):

| URL / source | Expected eyebrow | Expected CTA primary |
|---|---|---|
| `/` (no signal) | "Built for serious research" | "Start free" |
| `/?p=osint` | "For investigative work" | "See the Investigative mode" |
| `/?p=uap` | "For non-consensus research" | "See an Anomaly Correlation report" |
| `/?p=academic` | "For literature work that has to hold up" | "Student plan — $9/mo" |
| `/?p=patent` | "For prior-art work that catches what others miss" | "See a Patent Gap report" |
| arrive from r/UFOs (no param) | UAP eyebrow | UAP CTA |
| arrive from bellingcat.com | OSINT eyebrow | OSINT CTA |
| arrive from elicit.com | Academic eyebrow | Academic CTA |

If any of these are wrong, check `personaResolver.ts` first — the
referrer regexes are the most likely drift source.

---

## What this WO explicitly does NOT do

- **Does NOT implement the animated multi-agent pipeline hero.** That
  is WO-W. WO-V provides the canvas surface and the persona context;
  WO-W mounts inside.
- **Does NOT implement light mode.** The strategic doc and the Master
  Brief presume dark mode. A light variant of the lab notebook would
  require re-tuning every contrast value.
- **Does NOT implement a CMS / content service for persona copy.**
  Per Rule 26 I-4, copy lives in typed code. Adding a CMS is a
  separate operational and security decision.
- **Does NOT enforce persona detection accuracy.** If the heuristics
  in `personaResolver.ts` misclassify a small fraction of traffic,
  the fallback is the default variant — which is the existing copy.
  Worst case is no improvement, never a worse experience than today.
- **Does NOT collect any PII.** Per Rule 26 I-2. Future demands for
  "let's just track which persona converted at which step" should
  be evaluated against this invariant — if the new field isn't a
  validated enum, push back.

---

## Companion Work Orders

| WO | Status | Composition with WO-V |
|---|---|---|
| **WO-U** | Cost sidecar (separate package) | Fully independent. No touch points. |
| **WO-V** | THIS WO | — |
| **WO-W** | Animated multi-agent pipeline hero | Mounts INSIDE `LabNotebookCanvas`. Reads persona via `data-persona` attribute on `PersonaAwareHero`'s section. Persona-specific beam color palettes are WO-W's responsibility, not this WO's. |
| **WO-X** | Academic formatting engine (Pandoc + xelatex) | No touch with WO-V; touches WO-U via the new `citation_formatter` role. |
