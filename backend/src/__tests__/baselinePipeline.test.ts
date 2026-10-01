import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(async (options: { messages: Array<{ content: string }> }) => {
    const asked = options.messages.map((message) => message.content).join('\n');
    const content = asked.includes('Section to draft: Summary')
      ? 'The FDA authorized Casgevy in December 2023. It was the first CRISPR-based therapy approved in the United States. [1]'
      : asked.includes('Key findings')
        ? '- Casgevy edits a patient\'s own blood stem cells. [1]\n- The authorization was for sickle cell disease. [1]'
        : 'The FDA authorization covered patients 12 and older with recurrent vaso-occlusive crises. [1]';
    return { content, model: 'test', role: 'section_drafter', promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' };
  }),
  getSystemPrompt: () => 'Write the section.',
}));

import { generateIterativeReport, deriveGeneratedReportTitle } from '../services/reasoning/reportGenerator';
import { scoreStoredReport } from '../services/eval/scoreReport';
import { judgeReportQuality } from '../services/eval/reportQualityJudge';
import { buildCanonicalExecutionPlan } from '../services/planning/executionPlan';
import { getOrchestrationProfileForIntent } from '../services/planning/orchestrationProfiles';
import { stripGradeLines } from '../services/reasoning/baselineReport';

describe('baseline report pipeline', () => {
  beforeEach(() => {
    process.env.BASELINE_LAYER_ENABLED = 'true';
  });

  it('writes a switched-on report through the generator, with system references and topic headings', async () => {
    const report = await generateIterativeReport({
      query: 'When did the FDA authorize the first CRISPR therapy?',
      plan: {},
      sourceContext: 'Evidence Tier: established_fact\nCongressional testimony said the vote was public.\nStatistical inference was not required.',
      retrieverAnalysis: '',
      reasoningChains: '',
      challenges: '',
      intentId: 'factual_report',
      outputTemplateId: 'intent_factual_report',
      skipChallenger: true,
      usedSources: [{ title: 'FDA Casgevy authorization', publisher: 'US Food and Drug Administration', date: 'December 2023', url: 'https://www.fda.gov/casgevy' }],
    });
    expect(report.markdown).toContain('How did the FDA authorize the first CRISPR therapy is described');
    expect(report.markdown).toContain('1 source was read');
    expect(report.markdown).toContain('## Key findings');
    expect(report.markdown).toContain('## References');
    expect(report.markdown).toContain('1. US Food and Drug Administration, FDA Casgevy authorization, December 2023');
    expect(report.markdown).toContain('1 source was read');
    expect(report.sections.find((section) => section.key === 'references')?.content).toContain('fda.gov');
    expect(report.markdown).toContain('[1]');
    const scores = scoreStoredReport({
      reportMarkdown: `# ${deriveGeneratedReportTitle('When did the FDA authorize the first CRISPR therapy?', report.markdown)}\n${report.markdown}`,
      citations: [],
      reportQuality: await judgeReportQuality(report.markdown, async () => ({ content: '{"score": 4}', model: 'test', role: 'verifier', promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' })),
    });
    expect(scores.presentation_clean).toBe(1);
    expect(scores.report_quality).toBe(4);
    expect(stripGradeLines('Congressional testimony said the vote was public.\nStatistical inference was not required.')).toContain('Congressional testimony');
    const plan = buildCanonicalExecutionPlan({
      profile: getOrchestrationProfileForIntent('reference_lookup'),
      corpusEmpty: true,
    });
    expect(plan.skipReasons.discovery).toBeUndefined();
  });
});
