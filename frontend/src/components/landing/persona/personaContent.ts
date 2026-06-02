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
 * structural differentiators no incumbent can match (Skeptic agent,
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
    headline: 'Research that defends itself.',
    subhead:
      'ResearchOne runs a 10-stage, 7-agent pipeline — including a dedicated Skeptic — so every claim ships with the citation, the counter-claim, and the version it came from.',
    ctas: [
      { label: 'Open a sample report', to: '/sample-report', variant: 'primary' },
      { label: 'See the methodology', to: '/methodology', variant: 'secondary' },
    ],
  },

  // ──────────────────────────────────────────────────────────────
  // OSINT / Investigative journalism.
  // Anti-fluff, technical, emphasizes Devil's Advocate Review and FOIA/
  // Wayback source discovery per the strategic doc.
  // ──────────────────────────────────────────────────────────────
  osint: {
    eyebrow: 'For investigative work',
    headline: 'Skeptic reasoning for stories that don\u2019t survive consensus.',
    subhead:
      'A dedicated Skeptic agent. Contradictions preserved as data, not flattened to a single answer. ' +
      'Audit-trail citations you can hand to your editor or your lawyer.',
    ctas: [
      { label: 'See the Investigative mode', to: '/sample-report?topic=investigative', variant: 'primary' },
      { label: 'Pricing',                    to: '/pricing',                          variant: 'secondary' },
    ],
    proofLine: 'Research policy \u00B7 Open-weight reasoning \u00B7 No corporate alignment filters on the critical path.',
  },

  // ──────────────────────────────────────────────────────────────
  // UAP / paranormal disclosure community.
  // Emphasizes weak-signal preservation and absence of institutional
  // gatekeeping per the strategic doc.
  // ──────────────────────────────────────────────────────────────
  uap: {
    eyebrow: 'For non-consensus research',
    headline: 'A research engine that keeps weak signals on the record.',
    subhead:
      'Built on open-weight models with no alignment filter overriding what the sources actually say. ' +
      'Convergence Analysis mode: map weak signals, preserve contradictions, surface what the official story omits.',
    ctas: [
      { label: 'See a Convergence Analysis report', to: '/sample-report?topic=anomaly-correlation', variant: 'primary' },
      { label: 'How it works',                       to: '/methodology',                            variant: 'secondary' },
    ],
    proofLine: 'Skeptic agent on every claim \u00B7 Five source-corroboration tiers from established_fact to speculation \u00B7 You see the reasoning, not just the verdict.',
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
      'Industry-wide AI bibliographies hallucinate 26\u201360% of references. ResearchOne maps every claim ' +
      'to a source card with a tier label \u2014 PRISMA-style traceability, defensible at peer review.',
    ctas: [
      { label: 'Student plan \u2014 $9/mo', to: '/pricing#student',  variant: 'primary' },
      { label: 'Methodology',               to: '/methodology',      variant: 'secondary' },
    ],
    proofLine: 'Source-corroboration tiers \u00B7 Contradiction preservation \u00B7 Post-publication revision when the literature moves.',
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
      'Patent / Technical Gap mode maps the prior-art landscape the same way an examiner does \u2014 ' +
      'but surfaces non-consensus and cross-discipline references the big patent databases miss.',
    ctas: [
      { label: 'See a Patent Gap report',  to: '/sample-report?topic=patent-gap', variant: 'primary' },
      { label: 'Sovereign / on-prem',      to: '/sovereign',                  variant: 'secondary' },
    ],
    proofLine: 'Citation Integrity Checker \u00B7 Lossless evidence aliases \u00B7 Source-diverse, not source-voluminous.',
  },
};

export function getPersonaContent(persona: PersonaId): HeroContent {
  return PERSONA_CONTENT[persona] ?? PERSONA_CONTENT.default;
}
