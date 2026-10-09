/**
 * Persona content map — typed hero copy variants.
 *
 * Per Cursor rule 26 I-3: the 'default' variant MUST match the
 * existing `Hero.tsx` copy character-for-character. If you change one,
 * change the other in the same PR.
 *
 * Per Cursor rule 26 I-4: this is a typed const map, NOT a CMS-driven
 * content service. Editing here is a normal code change with PR
 * review.
 *
 * Per Cursor rule 26 I-9: visual variants (beam colors, etc.) belong
 * in WO-W. This file is content only.
 *
 * Per Master Brief: the four persona variants below were selected
 * because they are the four buyer tribes where ResearchOne wins on
 * structural differentiators no incumbent can match (Double-check,
 * uncensored open-weight reasoning, contradiction-as-data,
 * post-publication revision).
 */

import type { PersonaId } from './personaResolver';

export interface HeroCTA {
  label: string;
  to: string;          // react-router path
  variant: 'primary' | 'secondary';
}

export interface HeroContent {
  eyebrow: string;
  headline: string;
  subhead: string;
  ctas: readonly HeroCTA[];
  /** Optional one-liner shown beneath the CTAs (proof point / social proof). */
  proofLine?: string;
}

export const PERSONA_CONTENT: Record<PersonaId, HeroContent> = {
  // ──────────────────────────────────────────────────────────────
  // DEFAULT — character-for-character match to existing Hero.tsx.
  // Per rule 26 I-3, do not drift from existing copy without
  // updating Hero.tsx in the same commit.
  // ──────────────────────────────────────────────────────────────
  default: {
    eyebrow: 'DEEP RESEARCH PLATFORM',
    headline: 'Deep research that adapts to the question.',
    subhead:
      'Ask for an explanation, comparison, evidence review, opportunity map, implementation plan, or fact check. ResearchOne builds a plan, gathers sources, selects the right specialists, and produces a cited report with uncertainty and contradictions made visible.',
    ctas: [
      { label: 'Open a sample report', to: '/sample-report', variant: 'primary' },
      { label: 'See the methodology', to: '/methodology', variant: 'secondary' },
    ],
  },

  // ──────────────────────────────────────────────────────────────
  // OSINT / Investigative journalism.
  // Anti-fluff, technical, emphasizes Double-check and FOIA/
  // Wayback source discovery per the strategic doc.
  // ──────────────────────────────────────────────────────────────
  osint: {
    eyebrow: 'For investigative work',
    headline: 'Built to challenge stories that don’t survive consensus.',
    subhead:
      'A dedicated Double-check step. Contradictions preserved as data, not flattened to a single answer. ' +
      'Audit-trail citations you can hand to your editor or your lawyer.',
    ctas: [
      { label: 'See the Investigative mode', to: '/sample-report?topic=investigative', variant: 'primary' },
      { label: 'Pricing',                    to: '/pricing',                          variant: 'secondary' },
    ],
    proofLine: 'Research policy · Open-weight reasoning · No corporate alignment filters on the critical path.',
  },

  // ──────────────────────────────────────────────────────────────
  // Internally routed persona id preserved for tests/beam selection.
  // Public-facing copy stays neutral and professional.
  // ──────────────────────────────────────────────────────────────
  uap: {
    eyebrow: 'For investigative research',
    headline: 'A research engine for contested public-record questions.',
    subhead:
      'Built for complex questions where records, timelines, and source accounts do not line up cleanly. ' +
      'ResearchOne maps the evidence, keeps source disagreements visible, and helps you review competing interpretations without flattening them.',
    ctas: [
      { label: 'See an investigative report', to: '/sample-report?topic=investigative', variant: 'primary' },
      { label: 'How it works',                to: '/methodology',                  variant: 'secondary' },
    ],
    proofLine: 'Specialist verification when needed · Source-corroboration tiers stay visible · You see the evidence trail, not just the verdict.',
  },

  // ──────────────────────────────────────────────────────────────
  // Academic / graduate students.
  // "State and Validate" tone per the strategic doc — validate the
  // pain of manual review without manipulating it.
  // ──────────────────────────────────────────────────────────────
  academic: {
    eyebrow: 'For literature work that has to hold up',
    headline: 'Citation-grade reports without the hallucinated bibliography.',
    subhead:
      'Industry-wide AI bibliographies hallucinate 26–60% of references. ResearchOne maps every finding ' +
      'to a source card with a tier label — PRISMA-style traceability, defensible at peer review.',
    ctas: [
      { label: 'Student plan — coming soon', to: '/pricing#student',  variant: 'primary' },
      { label: 'Methodology',               to: '/methodology',      variant: 'secondary' },
    ],
    proofLine: 'Source-corroboration tiers · Contradiction preservation · Post-publication revision when the literature moves.',
  },

  // ──────────────────────────────────────────────────────────────
  // Patent / IP.
  // Mechanism-gap and non-consensus prior art positioning per the
  // Master Brief.
  // ──────────────────────────────────────────────────────────────
  patent: {
    eyebrow: 'For prior-art work that catches what others miss',
    headline: 'Non-consensus prior art and mechanism-gap analysis.',
    subhead:
      'Patent / Technical Gap mode maps the prior-art landscape the same way an examiner does — ' +
      'but surfaces non-consensus and cross-discipline references the big patent databases miss.',
    ctas: [
      { label: 'See a Patent Gap report',  to: '/sample-report?topic=patent-gap', variant: 'primary' },
      { label: 'See pricing',              to: '/pricing',                    variant: 'secondary' },
    ],
    proofLine: 'Citation Integrity Checker · Lossless evidence aliases · Source-diverse, not source-voluminous.',
  },
};

export function getPersonaContent(persona: PersonaId): HeroContent {
  return PERSONA_CONTENT[persona] ?? PERSONA_CONTENT.default;
}
