# PATCH V01 — `index.css`: Lab-notebook canvas layer

**File:** `frontend/src/index.css`
**Why:** The lab-notebook aesthetic prescribed by the strategic doc
needs (1) new CSS custom properties for the muted blue ruling and
muted red margin, (2) a `.lab-notebook-canvas` class that paints the
background via stacked gradients, and (3) dark-mode font-weight
adjustments per Rule 26 I-6 (body text shifts from 400 → 500, headings
get +100 for readability).

**Behavioral guarantee:** Pure additive change. The existing `.grid-bg`
utility, `:root` properties, components and utilities are untouched.
Pages that don't opt in to `.lab-notebook-canvas` look identical to
today.

---

## Step 1 — Add custom properties to `:root` (lines 6–14)

Find the existing `:root` block:

```css
@layer base {
  :root {
    --color-bg: #090d13;
    --color-surface: #111827;
    --color-surface-2: #172033;
    --color-surface-3: #1e293b;
    --color-border: rgba(99, 102, 241, 0.15);
    --color-accent: #6366f1;
    --color-accent-glow: rgba(99, 102, 241, 0.3);
  }
```

**Append the lab-notebook properties** before the closing `}`:

```css
@layer base {
  :root {
    --color-bg: #090d13;
    --color-surface: #111827;
    --color-surface-2: #172033;
    --color-surface-3: #1e293b;
    --color-border: rgba(99, 102, 241, 0.15);
    --color-accent: #6366f1;
    --color-accent-glow: rgba(99, 102, 241, 0.3);

    /* Lab Notebook visual tokens — WO-V.
     * Mirrored in frontend/src/components/landing/visual/labNotebookTokens.ts
     * If you change values here, change them there too in the same commit.
     * Per Cursor rule 26 I-6, opacity ceilings are enforced because higher
     * values drop body-text contrast below WCAG AAA (7:1).
     */
    --r1-notebook-bg: #0A0E1A;
    --r1-notebook-rule-h: rgba(140, 171, 217, 0.08);
    --r1-notebook-rule-v: rgba(167, 51, 43, 0.15);
    --r1-notebook-line-spacing: 40px;
    --r1-notebook-margin-position: 80px;
    --r1-notebook-line-thickness: 1px;
    --r1-notebook-text-body: #E0E0E0;
    --r1-notebook-text-heading: #F0F2F5;
  }
```

## Step 2 — Add the canvas class to `@layer components`

Find the existing `.grid-bg` class at line 131:

```css
  .grid-bg {
    background-image: linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px);
    background-size: 40px 40px;
  }
}
```

**Add the new `.lab-notebook-canvas` class immediately before the
closing `}` of the `@layer components` block:**

```css
  .grid-bg {
    background-image: linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px);
    background-size: 40px 40px;
  }

  /* Lab Notebook canvas — WO-V.
   * Stacked gradients: vertical red margin line painted first, then
   * the repeating horizontal blue ruling, then the base background
   * color. Pure CSS — no image, no SVG, no base64. GPU-accelerated
   * because gradients render through the compositor.
   *
   * Apply to a wrapper that contains the entire dark-mode landing
   * experience. See LabNotebookCanvas.tsx for the React wrapper.
   */
  .lab-notebook-canvas {
    background-color: var(--r1-notebook-bg);
    background-image:
      /* Vertical red margin line. */
      linear-gradient(
        90deg,
        transparent calc(var(--r1-notebook-margin-position) - var(--r1-notebook-line-thickness)),
        var(--r1-notebook-rule-v) calc(var(--r1-notebook-margin-position) - var(--r1-notebook-line-thickness)),
        var(--r1-notebook-rule-v) var(--r1-notebook-margin-position),
        transparent var(--r1-notebook-margin-position)
      ),
      /* Horizontal blue ruling. */
      repeating-linear-gradient(
        180deg,
        transparent,
        transparent calc(var(--r1-notebook-line-spacing) - var(--r1-notebook-line-thickness)),
        var(--r1-notebook-rule-h) calc(var(--r1-notebook-line-spacing) - var(--r1-notebook-line-thickness)),
        var(--r1-notebook-rule-h) var(--r1-notebook-line-spacing)
      );
    background-size: 100% 100%;
  }

  /* Dark-mode typography tightening — Rule 26 I-6.
   * Bump body and heading weights +100 against dark backgrounds to
   * compensate for the visual thinning effect of low-contrast text
   * on dark grounds. Applies only within the lab-notebook canvas so
   * the rest of the app retains its existing weights.
   */
  .lab-notebook-canvas {
    color: var(--r1-notebook-text-body);
  }
  .lab-notebook-canvas h1,
  .lab-notebook-canvas h2,
  .lab-notebook-canvas h3 {
    color: var(--r1-notebook-text-heading);
    font-weight: 600;
  }
  .lab-notebook-canvas p,
  .lab-notebook-canvas li {
    font-weight: 500;
  }

  /* The vertical margin only makes sense on wide enough viewports.
   * Below the breakpoint, the margin line crowds mobile reading; hide
   * it but keep the horizontal ruling. */
  @media (max-width: 640px) {
    .lab-notebook-canvas {
      background-image:
        repeating-linear-gradient(
          180deg,
          transparent,
          transparent calc(var(--r1-notebook-line-spacing) - var(--r1-notebook-line-thickness)),
          var(--r1-notebook-rule-h) calc(var(--r1-notebook-line-spacing) - var(--r1-notebook-line-thickness)),
          var(--r1-notebook-rule-h) var(--r1-notebook-line-spacing)
        );
    }
  }

  /* Users who prefer reduced motion or who explicitly disable the
   * ruling via a body class can opt out. Useful for printing the
   * landing as a PDF (the ruling photocopies poorly). */
  .lab-notebook-canvas.no-ruling {
    background-image: none;
  }
}
```

## Step 3 — Verify

```bash
cd frontend
npx tsc --noEmit
npm run build
```

Visual check: temporarily add `<div className="lab-notebook-canvas" style={{minHeight:'100vh'}} />`
to LandingPage.tsx as a smoke test. Confirm:
- Background is the muted near-black (`#0A0E1A`).
- Subtle horizontal blue lines every 40px (squint to see them — they're
  intentionally muted).
- A faint red vertical line at 80px from the left edge.
- On mobile (<640px viewport), the red margin is hidden, ruling remains.
- The body text uses the new off-white color, weight 500.

Remove the smoke test after verification — PATCH-V04 wires it in
properly.

## Test consequence

The contrast assertion is a runtime check, not a vitest assertion —
it's verified by manual smoke at `/landing-contrast-check.html`
(created in PATCH-V03 below if desired, or skipped for first
iteration). Per Rule 26 I-6.
