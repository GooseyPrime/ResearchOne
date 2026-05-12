/**
 * Lab Notebook visual tokens — canonical numerical constants.
 *
 * These mirror the CSS custom properties set in `index.css` so React
 * components that need numeric values (e.g. for inline SVG sizing in
 * WO-W's animated pipeline) read from the same source of truth as the
 * stylesheet.
 *
 * Per Cursor rule 26 I-5: the lab notebook is rendered via pure
 * CSS gradients. This file does NOT export any image, encoded raster
 * payloads, or SVG path. It only exports the math used by both the CSS and the
 * downstream React components.
 *
 * If you change these values, update `:root` in `index.css` in the
 * SAME commit. The constants are co-canonical with the stylesheet.
 *
 * Per Cursor rule 26 I-6: alpha values below have been tuned against
 * the `r1-bg` (#0A0E1A) background to land body-text contrast at
 * ≥ 7:1 (WCAG AAA). Do not raise opacity past the documented ceilings
 * without re-running the contrast check at `/landing-contrast-check.html`.
 */

export const LAB_NOTEBOOK_TOKENS = {
  // Background — matches the existing r1-bg in tailwind.config.js.
  background: '#0A0E1A',

  // Horizontal ruling — muted, highly transparent blue.
  // Opacity ceiling: 0.12. Above that, body-text contrast drops below 7:1.
  ruleHorizontal: 'rgba(140, 171, 217, 0.08)',
  ruleHorizontalOpacityCeiling: 0.12,

  // Vertical margin line — muted, highly transparent red.
  // Opacity ceiling: 0.20. Above that, the line dominates the hero
  // and reduces the muted "old paper" feel that's the point.
  ruleVertical: 'rgba(167, 51, 43, 0.15)',
  ruleVerticalOpacityCeiling: 0.20,

  // Line geometry. 40px ruling matches handwritten college-ruled
  // notebook paper at typical screen DPI. Margin position approximates
  // the real-world 1-inch left margin of a US Letter sheet.
  lineSpacingPx: 40,
  marginPositionPx: 80,
  lineThicknessPx: 1,

  // Body text — off-white. NEVER #FFFFFF on this background — halation
  // effect at full contrast reduces reading speed by ~20% per the
  // dark-mode typography research summarized in
  // docs/WO-V_VISUAL_DESIGN_NOTES.md.
  bodyText: '#E0E0E0',

  // Heading text — slightly brighter for hierarchical lift, still off
  // pure white.
  headingText: '#F0F2F5',

  // Dimmed/secondary text — must remain readable on the lab-notebook
  // ground.
  mutedText: '#94A3B8',
} as const;

export type LabNotebookTokens = typeof LAB_NOTEBOOK_TOKENS;
