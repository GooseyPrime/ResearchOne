/**
 * Beam color palettes per persona.
 *
 * Per Cursor rule 27 I-5: this file is the ONLY place beam colors
 * live. WO-V's `personaContent.ts` carries words; this file carries
 * visual variants. Adding either kind of content to the other file
 * violates the split.
 *
 * Per Cursor rule 27 I-9: every palette must remain perceptible
 * under deuteranopia / protanopia / tritanopia simulations. The
 * primary contrast vector is BRIGHTNESS (bright beam head vs.
 * dimmer trailing tail), not hue. Hue is the secondary signal
 * carrying persona affiliation.
 *
 * Per Cursor rule 27 I-7: do not introduce filter-based glows here.
 * The "glow" is achieved by stacking a wider, lower-opacity stroke
 * underneath the bright stroke — done in `pipelineBeams.tsx`.
 */

import type { PersonaId } from '../persona/personaResolver';

export interface BeamPalette {
  /** Bright beam head — the moving "pulse" point. Should be the
   *  brightest color in the palette. */
  beamHead: string;
  /** Mid stop on the gradient — visible tail behind the head. */
  beamMid: string;
  /** Far stop — fades to transparent. Use `transparent` or rgba(...,0). */
  beamTail: string;
  /** Static line color of the path underneath the beam (visible between
   *  beam passes). Subtle, low contrast against background. */
  trackColor: string;
  /** Node ring color when idle (default state). */
  nodeIdleRing: string;
  /** Node ring color when "active" — the moment a beam is entering or
   *  leaving. Brighter than idle. */
  nodeActiveRing: string;
  /** Skeptic node ring color — overrides nodeActiveRing for the Skeptic
   *  stage per Rule 27 I-4. Brightest in the palette. */
  skepticRing: string;
}

/* ─────────────────────────────────────────────────────────────────
 * Palettes.
 *
 * Default palette uses the existing `r1-accent` (#5BCEFA — cyan) and
 * builds the family around it so default-state visitors see continuity
 * with the rest of the brand.
 *
 * Other palettes are tuned per Master Brief tribe positioning:
 *   - osint:    cool blue, technical / surveillance aesthetic
 *   - uap:      violet / red, anomaly / strangeness aesthetic
 *   - academic: teal / gold, scholarly aesthetic
 *   - patent:   amber / green, industrial / IP aesthetic
 *
 * Brightness rank within each palette (lightest to darkest):
 *   beamHead  > nodeActiveRing > skepticRing > beamMid > nodeIdleRing > beamTail > trackColor
 *
 * Skeptic ring is brighter than nodeActiveRing so the Skeptic stays
 * visibly distinguished even when neighboring nodes light up.
 * ───────────────────────────────────────────────────────────────── */

export const BEAM_PALETTES: Record<PersonaId, BeamPalette> = {
  default: {
    beamHead:        '#A5E5FF',      // bright cyan
    beamMid:         '#5BCEFA',      // r1-accent
    beamTail:        'rgba(91, 206, 250, 0)',
    trackColor:      'rgba(91, 206, 250, 0.18)',
    nodeIdleRing:    'rgba(91, 206, 250, 0.35)',
    nodeActiveRing:  '#5BCEFA',
    skepticRing:     '#A5E5FF',      // matches beamHead — bright but on-brand
  },

  // OSINT — cooler, more technical. Indigo / sky blue.
  osint: {
    beamHead:        '#C0E0FF',
    beamMid:         '#4A8FE0',
    beamTail:        'rgba(74, 143, 224, 0)',
    trackColor:      'rgba(74, 143, 224, 0.18)',
    nodeIdleRing:    'rgba(120, 160, 220, 0.30)',
    nodeActiveRing:  '#6FA0E5',
    skepticRing:     '#E0F0FF',      // near-white — flags the adversarial step
  },

  // UAP — anomaly aesthetic. Violet with red highlights.
  // Hue choice intentionally drifts from "responsible business SaaS"
  // because the UAP community evaluates seriousness via aesthetic
  // refusal to match institutional templates.
  uap: {
    beamHead:        '#FFB8E0',      // bright magenta
    beamMid:         '#A855F7',      // purple-500
    beamTail:        'rgba(168, 85, 247, 0)',
    trackColor:      'rgba(168, 85, 247, 0.20)',
    nodeIdleRing:    'rgba(168, 85, 247, 0.30)',
    nodeActiveRing:  '#C084FC',
    skepticRing:     '#FF6B9D',      // saturated rose — the "anomaly" marker
  },

  // Academic — scholarly. Teal with gold accent for the Skeptic.
  academic: {
    beamHead:        '#C6F6E0',
    beamMid:         '#14B8A6',      // teal-500
    beamTail:        'rgba(20, 184, 166, 0)',
    trackColor:      'rgba(20, 184, 166, 0.18)',
    nodeIdleRing:    'rgba(20, 184, 166, 0.30)',
    nodeActiveRing:  '#2DD4BF',
    skepticRing:     '#F59E0B',      // amber — the peer-review highlight
  },

  // Patent / IP — industrial. Amber primary, green skeptic.
  patent: {
    beamHead:        '#FEF3C7',
    beamMid:         '#F59E0B',      // amber-500
    beamTail:        'rgba(245, 158, 11, 0)',
    trackColor:      'rgba(245, 158, 11, 0.18)',
    nodeIdleRing:    'rgba(245, 158, 11, 0.30)',
    nodeActiveRing:  '#FBBF24',
    skepticRing:     '#86EFAC',      // green — the "novelty confirmed" marker
  },
};

/** Safe lookup — returns the default palette if the id is unknown. */
export function getBeamPalette(persona: PersonaId | string | null | undefined): BeamPalette {
  if (!persona) return BEAM_PALETTES.default;
  return (BEAM_PALETTES as Record<string, BeamPalette>)[persona] ?? BEAM_PALETTES.default;
}
