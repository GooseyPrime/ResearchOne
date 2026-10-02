import { describe, expect, it } from 'vitest';
import { RESEARCH_INTEGRITY_KNOWLEDGE_BASE_BLOCK } from '../constants/prompts';
import { applySystemAugmentations } from '../services/openrouter/openrouterService';
import { deriveGeneratedReportTitle } from '../services/reasoning/reportGenerator';
import {
  plainQuestionIntent,
  presentationFailures,
  readerSections,
  readerTitle,
  removeRepeatedSentences,
  scoreNoRepetition,
  scorePresentationClean,
  scoreStructureComplete,
  stripGradeLines,
  trimSummaryAtSentence,
} from '../services/reasoning/baselineReport';

const SAMPLE = `# What the FDA authorized
## Summary
The FDA authorized Casgevy, the first CRISPR-based therapy, in December 2023.
## Key findings
- Casgevy is a CRISPR therapy for sickle cell disease.
## What the sources report
The authorization covered patients 12 and older with recurrent vaso-occlusive crises.
## Limits of this report
Data after the authorization decision was not re-reviewed.
## About this report
Two sources were read on 1 Oct 2026.
`;

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
    expect(readerTitle('What year was it?', 'What year was it?')).not.toBe('What year was it?');
    expect(readerTitle('What year was it?', 'What year was it?')).not.toContain('is described');
  });

  it('uses the reader section order and a short summary', () => {
    expect(readerSections('factual_report', 'rail costs').map((section) => section.title)[0]).toBe('Summary');
    expect(readerSections('how_to').some((section) => section.title === 'References')).toBe(true);
    expect(trimSummaryAtSentence('word '.repeat(200)).split(/\s+/).length).toBeLessThanOrEqual(150);
  });

  it('strips grades from the writer context and scores a clean fixture in CI', () => {
    expect(stripGradeLines('Evidence Tier: established_fact\nThe study reported a result.')).not.toMatch(/established_fact/);
    expect(scorePresentationClean(SAMPLE)).toBe(1);
    expect(scoreNoRepetition([{ content: SAMPLE }])).toBe(1);
    expect(presentationFailures('The verdict was established_fact.')).toContain('courtroom');
  });

  it('removes a repeated sentence after one redraft still repeats', () => {
    const sentence = 'The FDA authorized Casgevy for sickle cell disease in December 2023.';
    const cleaned = removeRepeatedSentences([
      { key: 'a', title: 'Summary', content: sentence },
      { key: 'b', title: 'Body', content: sentence },
    ]);
    expect(cleaned[1].content).not.toContain('Casgevy');
  });

  it('removes the posted sample sentence when a citation marker follows it', () => {
    const sentence = 'The FDA authorization covered patients 12 and older with recurrent vaso-occlusive crises. [1]';
    const attached = 'The FDA authorization covered patients 12 and older with recurrent vaso-occlusive crises [1].';
    const cleaned = removeRepeatedSentences([
      { key: 'topic_0', title: 'Casgevy authorization', content: sentence },
      { key: 'topic_1', title: 'Eligible patient group', content: attached },
      { key: 'limits', title: 'Limits of this report', content: sentence },
    ]);
    expect(cleaned[0].content).toContain('vaso-occlusive');
    expect(cleaned[1].content).not.toContain('vaso-occlusive');
    expect(cleaned[2].content).not.toContain('vaso-occlusive');
    expect(cleaned[1].content.trim()).not.toBe('[1]');
    expect(cleaned[2].content.trim()).not.toBe('[1]');
  });

  it('routes a failed classifier to factual research', () => {
    process.env.BASELINE_LAYER_ENABLED = 'true';
    expect(plainQuestionIntent(true, false)).toBe('factual_report');
    delete process.env.BASELINE_LAYER_ENABLED;
  });
});
