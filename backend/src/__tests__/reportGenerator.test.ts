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
});
