# WO-V Visual Design Notes

These are the rationales behind the lab-notebook color and weight
choices. Surface them when a designer or stakeholder asks "why these
specific values."

## Why off-black, not pure black

Pure `#000000` against `#FFFFFF` text produces a *halation* effect —
the white characters appear to glow or bleed into the surrounding
space, especially on low-quality OLED panels. Independent dark-mode
typography research (cited in the strategic doc upload) reports
reading speed drops up to 20% in pure-black/pure-white combinations
compared to slightly-softened pairs.

We use `#0A0E1A` for the canvas (a near-black with a small blue
shift) paired with `#E0E0E0` body text. Contrast ratio: 13.5:1 —
well above WCAG AAA (7:1).

## Why off-white, not pure white

Same logic. `#FFFFFF` body text on `#0A0E1A` measures 21:1, which
*sounds* better but exceeds the human visual system's comfortable
contrast band. The eye adapts down, then text on adjacent UI
elements (cards, badges) at lower contrast becomes harder to read.

`#E0E0E0` lands the body at 13.5:1 — distinctive without saturating,
and leaves headroom for headings to *be* brighter (`#F0F2F5` =
17:1) without screaming.

## Why the muted blue and red opacity values

The strategic doc prescribes the lab-notebook aesthetic. A literal
recreation — opaque blue lines and a solid red margin — would
overpower a SaaS landing page. The muted alpha values
(`rgba(140,171,217,0.08)` and `rgba(167,51,43,0.15)`) deliver the
*suggestion* of ruled paper without dominating the layout.

We tuned by eye against the existing hero composition and tested at
1080p / 1440p / 4K. The 0.08 alpha for horizontal ruling reads as
"barely there" on a 24-inch 1080p panel and "clearly there" on a
27-inch 4K — both are correct readings for the intended aesthetic.

Ceilings in `labNotebookTokens.ts` are set conservatively:

| Token | Default | Ceiling | Why ceiling |
|---|---|---|---|
| `ruleHorizontal` | 0.08 | 0.12 | Above 0.12, body text contrast drops below 7:1 (WCAG AAA). |
| `ruleVertical` | 0.15 | 0.20 | Above 0.20, the red line draws the eye away from the headline. |

If a designer pushes back wanting more visible ruling, run the
contrast check at the new values before merging.

## Why 40px line spacing, not 24px or 32px

College-ruled notebook paper is 7.1mm at print scale (about 27px on a
typical 96 DPI screen). Wide-ruled is 8.7mm (about 33px). 40px is
slightly wider than both — chosen to:

1. Align cleanly with our existing 4-unit (16px) Tailwind spacing
   scale, since 40 = 16 + 24, both of which appear elsewhere in our
   layouts.
2. Survive zoom-out without becoming Moiré pattern noise at common
   zoom levels (90%, 80%, 67%).
3. Provide enough breathing room that the horizontal lines don't
   collide visually with single-line headings.

## Why the vertical margin at 80px

The MLA / APA standard is a 1-inch left margin, which at 96 DPI is 96
pixels — close to but not exactly our 80px. 80px aligns with our
default Tailwind page padding patterns and reads correctly against
the `max-w-6xl` content container on the landing.

On mobile (<640px) we hide the vertical margin entirely — at narrow
widths it crowds the content area and the aesthetic doesn't survive
the geometry change. Horizontal ruling stays.

## Why CSS gradients, not an SVG or image

Three reasons:

1. **Bandwidth.** A high-DPI SVG of ruled paper that survives 4K
   without aliasing is ~3KB compressed; a PNG fallback is ~12KB.
   CSS gradients add zero bytes.

2. **Performance.** Browsers composite linear gradients on the GPU.
   Image backgrounds trigger CPU paint on every resize. The landing's
   LCP score is sensitive to this — pre-WO-V the page was already
   sub-1.5s and we're not giving that up.

3. **Tunability.** CSS custom properties mean operators can
   experiment with line spacing or opacity in DevTools live and see
   the result instantly. An image would require regeneration for
   every tweak.

## Why the typography weight bump

Thin fonts (weight 300/400) that read fine on white look *anemic* on
near-black grounds — the eye perceives lighter weights as even
lighter against high-contrast dark backgrounds. The fix is a uniform
+100 weight shift inside the `.lab-notebook-canvas` scope: body goes
400→500, headings go 400→600.

This is scoped to the canvas class only. The rest of the app (auth
flows, the admin dashboard, the research pages) keeps its existing
weights — they don't sit on the lab-notebook ground.

## Why headings are `#F0F2F5`, not `#E0E0E0` like body

Subtle hierarchy. Headings need to read as *brighter* than body, but
pushing all the way to `#FFFFFF` reintroduces halation. `#F0F2F5`
splits the difference — measurably brighter than `#E0E0E0` (17:1 vs
13.5:1) without saturating.

You'll find this distinction is invisible to most users and obvious
to designers and accessibility auditors. Both groups are correct;
their evaluation criteria differ.

## What's deliberately not in WO-V

- **Light mode.** The strategic doc presumes dark mode throughout.
  A light-mode variant of the lab-notebook would require re-tuning
  every opacity and contrast value and is at least a half-day of
  work for marginal reward at this point.
- **Print stylesheet.** Reading a landing as a print-out is rare and
  the ruled background photocopies poorly. The `.no-ruling` class
  opt-out exists for the one operator who needs it.
- **High-contrast accessibility mode.** Should land later as a
  `prefers-contrast: high` media query that bumps the ruling lines
  to higher alphas and forces text to pure white. Scope-cut for now.
- **Animated entrance.** No fade-in / slide-in on the ruling itself.
  The strategic doc's animated content is the *foreground* beams
  (WO-W), not the background. The background should be present from
  the first paint.
