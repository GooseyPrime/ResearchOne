import { describe, it, expect, vi, beforeEach } from 'vitest';

const callRoleModelMock = vi.fn();

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: callRoleModelMock,
  SYSTEM_PROMPTS: {
    outline_architect: 'outline',
    section_drafter: 'draft',
    internal_challenger: 'challenge',
    coherence_refiner: 'refine',
  },
}));

describe('iterative report generator', () => {
  beforeEach(() => {
    callRoleModelMock.mockReset();
  });

  it('emits per-section progress and returns markdown', async () => {
    callRoleModelMock
      .mockResolvedValueOnce({ content: JSON.stringify({ outline: [{ title: 'Executive Summary' }] }) }) // outline
      .mockResolvedValueOnce({ content: 'Section body text' })
      .mockResolvedValueOnce({ content: 'Section body text' })
      .mockResolvedValueOnce({ content: 'Section body text' })
      .mockResolvedValueOnce({ content: 'Section body text' })
      .mockResolvedValueOnce({ content: 'Section body text' })
      .mockResolvedValueOnce({ content: 'Section body text' })
      .mockResolvedValueOnce({ content: 'Section body text' })
      .mockResolvedValueOnce({ content: 'Section body text' })
      .mockResolvedValueOnce({ content: 'Section body text' })
      .mockResolvedValueOnce({ content: 'Section body text' })
      .mockResolvedValueOnce({ content: '- challenge points' })
      .mockResolvedValueOnce({ content: '## Final Report\nRefined content' });

    const progress = vi.fn();
    const { generateIterativeReport } = await import('../services/reasoning/reportGenerator');

    const result = await generateIterativeReport({
      query: 'Test query',
      plan: {},
      evidenceContext: 'evidence',
      retrieverAnalysis: 'analysis',
      reasoningChains: 'reasoning',
      challenges: 'challenges',
      onSectionProgress: progress,
    });

    expect(progress).toHaveBeenCalledTimes(10);
    expect(result.sections).toHaveLength(10);
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(callRoleModelMock).toHaveBeenCalled();
  });

  it('throws when a known non-legacy intent is missing outputTemplateId', async () => {
    const { generateIterativeReport } = await import('../services/reasoning/reportGenerator');

    await expect(
      generateIterativeReport({
        query: 'Test query',
        plan: {},
        evidenceContext: 'evidence',
        retrieverAnalysis: 'analysis',
        reasoningChains: 'reasoning',
        challenges: 'challenges',
        intentId: 'opportunity_discovery',
      })
    ).rejects.toThrow(/INTENT_TEMPLATE_MISSING/);
  });

  it('throws when outputTemplateId intent does not match runtime intent', async () => {
    const { generateIterativeReport } = await import('../services/reasoning/reportGenerator');

    await expect(
      generateIterativeReport({
        query: 'Test query',
        plan: {},
        evidenceContext: 'evidence',
        retrieverAnalysis: 'analysis',
        reasoningChains: 'reasoning',
        challenges: 'challenges',
        intentId: 'implementation',
        outputTemplateId: 'intent_opportunity_discovery',
      })
    ).rejects.toThrow(/INTENT_TEMPLATE_MISMATCH/);
  });

  it('uses template sections for opportunity discovery runtime generation', async () => {
    callRoleModelMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          outline: [
            { title: 'Overview' },
            { title: 'Opportunities List' },
            { title: 'Viability Analysis' },
            { title: 'Build Guidance' },
            { title: 'Caveats' },
          ],
        }),
      })
      .mockResolvedValueOnce({ content: 'Overview body' })
      .mockResolvedValueOnce({ content: 'Opportunities body' })
      .mockResolvedValueOnce({ content: 'Viability body' })
      .mockResolvedValueOnce({ content: 'Build body' })
      .mockResolvedValueOnce({ content: 'Caveats body' })
      .mockResolvedValueOnce({ content: '- challenge points' })
      .mockResolvedValueOnce({ content: '## Final Report\nRefined content' });

    const { generateIterativeReport } = await import('../services/reasoning/reportGenerator');
    const result = await generateIterativeReport({
      query: 'opportunity query',
      plan: {},
      evidenceContext: 'evidence',
      retrieverAnalysis: 'analysis',
      reasoningChains: 'reasoning',
      challenges: 'challenges',
      intentId: 'opportunity_discovery',
      outputTemplateId: 'intent_opportunity_discovery',
    });

    expect(result.sections.map((section) => section.key)).toEqual([
      'overview',
      'opportunities_list',
      'viability_analysis',
      'build_guidance',
      'caveats',
    ]);
  });
});
