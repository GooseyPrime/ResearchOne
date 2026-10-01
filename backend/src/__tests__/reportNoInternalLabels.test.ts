/**
 * Report text a reader sees must not carry evidence-tier labels or internal
 * step names. Grades stay on claim rows; the prose stays prose. The inputs
 * below are taken from a production pilot report (1 Oct 2026).
 */
import { describe, expect, it } from 'vitest';
import { stripInternalLabelsFromReport } from '../services/reasoning/reportGenerator';
import { INTENT_OUTPUT_TEMPLATES, CLAIM_CLASS_SOURCING_BURDEN } from '../services/formatting/templates/intentOutputTemplates';
import { STANDARD_SYSTEM_PROMPTS, SYSTEM_PROMPTS } from '../services/openrouter/openrouterService';

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

  it('never changes code or Markdown link text', () => {
    const input = [
      'See [Testimony](https://example.org/hearing) and [Quantitative_Quality_Auditor](https://example.org/x).',
      'Inline `const strong_evidence = score;` stays.',
      '```ts',
      'const tier = "strong_evidence"; // [Strong_Evidence - Chunk 3]',
      '```',
    ].join('\n');
    expect(stripInternalLabelsFromReport(input)).toBe(input);
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

describe('instructions sent to the report writer, checker and refiner', () => {
  const NO_TAG_REQUIREMENT = /tier tag|evidence ledger section tagging|preserve all evidence tier|tagging all major claims|UNSUPPORTED CONJECTURE/i;
  const WRITER_ROLES = ['synthesizer', 'verifier', 'coherence_refiner', 'section_drafter', 'plain_language_synthesizer'] as const;

  it('never ask for evidence-tier labels in report text, in either prompt set', () => {
    for (const role of WRITER_ROLES) {
      expect(SYSTEM_PROMPTS[role], `SYSTEM_PROMPTS.${role}`).not.toMatch(NO_TAG_REQUIREMENT);
      expect(STANDARD_SYSTEM_PROMPTS[role], `STANDARD_SYSTEM_PROMPTS.${role}`).not.toMatch(NO_TAG_REQUIREMENT);
    }
  });

  it('never frame ordinary reports in terms of claims', () => {
    const texts = [...WRITER_ROLES.map((role) => STANDARD_SYSTEM_PROMPTS[role]), CLAIM_CLASS_SOURCING_BURDEN];
    for (const text of texts) {
      const withoutRule = text
        .split('\n')
        .filter((line) => !/Present information, not claims|does not call what its sources say "claims"/.test(line))
        .join('\n');
      expect(withoutRule).not.toMatch(/\bclaims?\b/i);
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
