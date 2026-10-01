/**
 * Report text a reader sees must not carry evidence-tier labels or internal
 * step names. Grades stay on claim rows; the prose stays prose. The inputs
 * below are taken from a production pilot report (1 Oct 2026).
 */
import { describe, expect, it } from 'vitest';
import { stripInternalLabelsFromReport } from '../services/reasoning/reportGenerator';
import { INTENT_OUTPUT_TEMPLATES } from '../services/formatting/templates/intentOutputTemplates';

const TIER_PATTERN = /established[_ ]fact|strong[_ ]evidence|\((?:testimony|inference|speculation)\)|\[(?:testimony|inference|speculation)\b/i;

describe('stripInternalLabelsFromReport', () => {
  it('drops the tier from a citation marker and keeps the chunk reference', () => {
    const input =
      'escalating to $5.2 billion by 2012 [Strong_Evidence - Chunk 3], and an allegation of fund diversion [Testimony - Chunk 11] whose motive is unclear [Inference - Chunk 2].';
    const out = stripInternalLabelsFromReport(input);
    expect(out).toBe(
      'escalating to $5.2 billion by 2012 [Chunk 3], and an allegation of fund diversion [Chunk 11] whose motive is unclear [Chunk 2].'
    );
    expect(out).not.toMatch(TIER_PATTERN);
  });

  it('removes internal step names in brackets', () => {
    const out = stripInternalLabelsFromReport('cross-project comparisons lack standardized metrics [Quantitative_Quality_Auditor].');
    expect(out).toBe('cross-project comparisons lack standardized metrics.');
  });

  it('removes parenthetical and snake-case tier labels', () => {
    const out = stripInternalLabelsFromReport(
      'The FDA authorized it in December 2023 (established_fact). STRONG_EVIDENCE: two trials agree (strong_evidence).'
    );
    expect(out).toBe('The FDA authorized it in December 2023. two trials agree.');
    expect(out).not.toMatch(TIER_PATTERN);
  });

  it('leaves ordinary prose, chunk references, lists and tables alone', () => {
    const input = [
      'Congressional testimony in 2019 described the delays [Chunk 4].',
      '',
      '- Item',
      '  - Nested item',
      '',
      '| Project | Cost |',
      '| :--- | ---: |',
      '| Madrid | $170M/mile |',
    ].join('\n');
    expect(stripInternalLabelsFromReport(input)).toBe(input);
  });
});

describe('reports present information, not claims', () => {
  // Brandon, 1 Oct 2026: a report presents information. Calling what sources
  // say a "claim" is courtroom framing. The challenge intents, where testing a
  // stated claim is the user's own request, are worded in the challenge slice.
  const CHALLENGE_INTENTS = new Set(['adjudication', 'investigation', 'story_verification']);

  it('ordinary report types never instruct the writer in terms of claims', () => {
    for (const template of Object.values(INTENT_OUTPUT_TEMPLATES)) {
      if (CHALLENGE_INTENTS.has(template.intentId)) continue;
      const text = [template.verifierRubric, template.narrativeHint, ...template.requiredDeliverables]
        .join('\n')
        .split('\n')
        .filter((line) => !line.includes('Does not frame what sources say as'))
        .join('\n');
      expect(text, template.id).not.toMatch(/\bclaims?\b/i);
    }
  });
});

describe('intent output templates', () => {
  it('no longer require evidence-tier tags in report text', () => {
    for (const template of Object.values(INTENT_OUTPUT_TEMPLATES)) {
      const text = `${template.verifierRubric}\n${template.requiredDeliverables.join('\n')}`;
      expect(text, template.id).not.toMatch(/tier tag|tier-tagged|evidence-tagged/i);
    }
  });
});
