import { describe, expect, it } from 'vitest';
import { RESEARCH_INTEGRITY_KNOWLEDGE_BASE_BLOCK } from '../constants/prompts';
import { applySystemAugmentations } from '../services/openrouter/openrouterService';
import { deriveGeneratedReportTitle } from '../services/reasoning/reportGenerator';

describe('baseline writing messages', () => {
  it('sends a factual writer neither the knowledge-base block nor the adversarial prefix', () => {
    const sent = applySystemAugmentations({
      role: 'section_drafter',
      baselineLayer: true,
      messages: [{ role: 'system', content: `${RESEARCH_INTEGRITY_KNOWLEDGE_BASE_BLOCK}\n\nWrite the section.` }],
    });
    expect(sent[0].content).not.toContain('potentially incomplete');
    expect(sent[0].content).not.toContain('adversarial researcher');
    expect(sent[0].content).toContain('Present information, not claims');
  });

  it('keeps both on an adjudication challenge pass', () => {
    const sent = applySystemAugmentations({
      role: 'skeptic',
      isAdjudicative: true,
      messages: [{ role: 'system', content: 'Check the finding.' }],
    });
    expect(sent[0].content).toContain('adversarial researcher');
  });

  it('does not title a report Framing or the raw request', () => {
    expect(deriveGeneratedReportTitle('What year was it?', '# Framing\n\nThe FDA authorized Casgevy in 2023.')).toBe(
      'The FDA authorized Casgevy in 2023.'
    );
  });
});
