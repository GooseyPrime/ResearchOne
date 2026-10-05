/**
 * A source's title belongs to the source. A report that cites "The Case for
 * Nuclear Power" must list it under that name: the check for courtroom wording
 * reads the report's own sentences, and the clean-up never rewrites the
 * reference list. Driven through the real report writer with the model replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(async (options: { role: string; messages: Array<{ content: string }> }) => {
    const asked = options.messages.map((message) => message.content).join('\n');
    const reply = (content: string) => ({ content, model: 'test', role: options.role, promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' });
    if (options.role === 'outline_architect') return reply('{"title":"Nuclear power economics","outline":["Construction cost","Operating record"]}');
    // The redraft does not come back in a form that can be used, so the words are taken out section by section.
    if (options.role === 'coherence_refiner') return reply('I cannot do that.');
    if (asked.includes('Section to draft: Summary')) return reply('Nuclear plants are costly to build and cheap to run [1].');
    if (asked.includes('Section to draft: Key findings')) return reply('- Build cost dominates the total [1].\n- Running cost is low [1].');
    if (asked.includes('Section to draft: Where sources disagree')) return reply('Critics claim the cost figures were estimates [1].');
    if (asked.includes('Section to draft: Construction cost')) return reply('Most of the lifetime cost is paid before the plant opens [1].');
    if (asked.includes('Section to draft: Operating record')) return reply('Plants ran at high output for decades [1].');
    return reply('The sources cover two countries only [1].');
  }),
  getSystemPrompt: () => 'Write the section.',
}));

import { cleanLayer1WordingForSave, finalizeLockedReportForSave, generateIterativeReport } from '../services/reasoning/reportGenerator';
import { issuePassages } from '../services/reasoning/citationLock';
import { readerFacingLabelHits } from '../services/formatting/reportPresentation';

const SOURCE = { title: 'The Case for Nuclear Power', publisher: 'Example Press', date: '2020-05-01', url: 'https://example.org/case' };

describe('a source whose title holds a banned phrase', () => {
  beforeEach(() => {
    process.env.BASELINE_LAYER_ENABLED = 'true';
  });
  afterEach(() => {
    delete process.env.BASELINE_LAYER_ENABLED;
  });

  it('keeps its title in the reference list while the report\'s own wording is put right', async () => {
    const report = await generateIterativeReport({
      query: 'Is nuclear power economic?',
      plan: {},
      sourceContext: 'context',
      retrieverAnalysis: '',
      reasoningChains: '',
      challenges: '',
      intentId: 'factual_report',
      outputTemplateId: 'intent_factual_report',
      skipChallenger: true,
      usedSources: [SOURCE],
    });
    expect(report.sections.find((section) => section.key === 'references')?.content).toContain('The Case for Nuclear Power');
    expect(report.sections.find((section) => section.key === 'disagreement')?.content).toBe('Critics state the cost figures were estimates [1].');
    expect(readerFacingLabelHits(report.markdown)).toEqual([]);
  });

  it('is not counted as courtroom wording, and the same phrase in a sentence still is', () => {
    const list = '## Summary\nPlants are costly to build [1].\n\n## References\n1. Example Press. The Case for Nuclear Power. https://example.org/case\n\n## About this report\n1 source was read.';
    expect(readerFacingLabelHits(list)).toEqual([]);
    expect(readerFacingLabelHits(list.replace('Plants are costly to build', 'The case for building is strong'))).toContain('courtroom');
    // A label printed in the list is still a leak.
    expect(readerFacingLabelHits(list.replace('https://example.org/case', 'https://example.org/case [Chunk 3]'))).toContain('chunk marker');
  });

  it('is listed under its own name by a locked report, with nothing recorded against it', () => {
    const passages = issuePassages([{ id: 'c1', content: 'Most of the lifetime cost is paid before the plant opens.' }], [SOURCE]);
    const { finalized, wordingAfter } = finalizeLockedReportForSave('## Summary\nThe evidence establishes that plants are costly to build [P1].', 'q', passages, 'numeric', '4 Oct 2026');
    expect(finalized.markdown).toContain('The sources show that plants are costly to build [1].');
    expect(finalized.markdown).toContain('The Case for Nuclear Power');
    expect(wordingAfter).toEqual([]);
  });
});

describe('the last wording check for a Layer 1 report without the lock', () => {
  const references = '## References\n1. Example Press. The Case for Nuclear Power. https://example.org/case';
  it('puts back into plain words what a repair pass reintroduced, and leaves the list alone', () => {
    const repaired = `## Summary\nThe evidence establishes that costs rose [1]. The agency claims the rule changed [1].\n\n${references}\n\n## About this report\n1 source was read.`;
    const out = cleanLayer1WordingForSave(repaired);
    expect(out.markdown).toContain('The sources show that costs rose [1]. The agency states the rule changed [1].');
    expect(out.markdown).toContain(references);
    expect(out.markdown.endsWith('## About this report\n1 source was read.')).toBe(true);
    expect(out.wordingAfter).toEqual([]);
  });

  it('returns a clean report exactly as it was', () => {
    const clean = `## Summary\nCosts rose [1].\n\n${references}`;
    expect(cleanLayer1WordingForSave(clean)).toEqual({ markdown: clean, wordingAfter: [] });
  });
});
