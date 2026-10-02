import { describe, expect, it } from 'vitest';
import { RESEARCH_INTEGRITY_KNOWLEDGE_BASE_BLOCK } from '../constants/prompts';
import { applySystemAugmentations } from '../services/openrouter/openrouterService';
import { deriveGeneratedReportTitle } from '../services/reasoning/reportGenerator';
import {
  plainQuestionIntent,
  presentationFailures,
  readerSections,
  readerTitle,
  renumberCitations,
  removeRepeatedSentences,
  scoreNoRepetition,
  scorePresentationClean,
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
    process.env.BASELINE_LAYER_ENABLED = 'true';
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

  it('keeps list lines and a trailing citation marker', () => {
    const bullets = removeRepeatedSentences([{ key: 'a', title: 'A', content: '- a.\n- b.' }]);
    expect(bullets[0].content).toBe('- a.\n- b.');
    const numbered = removeRepeatedSentences([{ key: 'a', title: 'A', content: '1. First.\n2. Second.' }]);
    expect(numbered[0].content).toBe('1. First.\n2. Second.');
    const marked = removeRepeatedSentences([{ key: 'a', title: 'A', content: 'Patients 12 and older were covered. [7]' }]);
    expect(marked[0].content).toContain('[7]');
    expect(marked[0].content).toContain('older');
  });

  it('renumbers markers to one number per source', () => {
    const sources = [
      { title: 'A', url: 'https://a.example' },
      { title: 'B', url: 'https://b.example' },
      { title: 'C', url: 'https://c.example' },
      { title: 'D', url: 'https://d.example' },
      { title: 'E', url: 'https://e.example' },
      { title: 'F', url: 'https://f.example' },
      { title: 'G', url: 'https://g.example' },
    ];
    const different = renumberCitations([{ content: 'One claim. [3] Another claim. [7]' }], sources);
    expect(different.sections[0].content).toContain('[1]');
    expect(different.sections[0].content).toContain('[2]');
    expect(different.cited).toHaveLength(2);
    const same = renumberCitations([{ content: 'One claim. [3] Same source again. [7]' }], [
      sources[0], sources[1], { title: 'Shared', url: 'https://shared.example' }, sources[3], sources[4], sources[5], { title: 'Shared', url: 'https://shared.example' },
    ]);
    expect(same.sections[0].content).toBe('One claim. [1] Same source again. [1]');
    expect(same.cited).toHaveLength(1);
  });

  it('routes a failed classifier to factual research', () => {
    process.env.BASELINE_LAYER_ENABLED = 'true';
    expect(plainQuestionIntent(true, false, 'When did the FDA authorize Casgevy?')).toBe('factual_report');
    expect(plainQuestionIntent(true, false, 'Is the claim that the moon landing was a hoax true?')).toBeNull();
    expect(plainQuestionIntent(true, false, 'Compare the evidence for and against cold fusion')).toBeNull();
    expect(plainQuestionIntent(true, false)).toBeNull();
    delete process.env.BASELINE_LAYER_ENABLED;
  });
});
