import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    invoke = invokeMock;
  },
}));

vi.mock('../config', () => ({
  config: {
    models: { synthesizer: 'test-model' },
    openrouter: { apiKey: 'token', baseUrl: 'https://openrouter.ai/api/v1' },
  },
}));

describe('iterative report generator', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('emits per-section progress and returns markdown', async () => {
    const sectionText = { content: 'Section body text' };
    invokeMock
      .mockResolvedValueOnce({ content: JSON.stringify(['Executive Summary']) }) // outline
      .mockResolvedValue(sectionText);

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
  });
});
