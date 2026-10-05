import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(async (options: { role: string; messages: Array<{ content: string }> }) => {
    const asked = options.messages.map((message) => message.content).join('\n');
    if (options.role === 'outline_architect') {
      return {
        content: '{"title":"FDA authorization of Casgevy","outline":["Casgevy authorization","Eligible patient group"]}',
        model: 'test',
        role: options.role,
        promptTokens: 1,
        completionTokens: 1,
        durationMs: 1,
        usedFallback: false,
        primaryModel: 'test',
      };
    }
    const content = asked.includes('Section to draft: Summary')
      ? 'The FDA authorized Casgevy in December 2023. It was the first CRISPR-based therapy approved in the United States. [1]'
      : asked.includes('Key findings')
        ? '- Casgevy edits a patient\'s own blood stem cells. [1]\n- The authorization was for sickle cell disease. [1]'
        : asked.includes('Where sources disagree')
          ? 'The sources do not disagree.'
          : asked.includes('Comparison table')
            ? '| Option | Note |\n| --- | --- |\n| Casgevy | First CRISPR therapy authorized in December 2023. [1] |'
            : asked.includes('Casgevy authorization')
            ? 'The FDA authorization covered patients 12 and older with recurrent vaso-occlusive crises. [1]'
            : 'The decision applied to sickle cell disease with recurrent crises. [1]';
    return { content, model: 'test', role: 'section_drafter', promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' };
  }),
  getSystemPrompt: () => 'Write the section.',
}));

import { generateIterativeReport, resolveReportWordTarget } from '../services/reasoning/reportGenerator';
import { callRoleModel } from '../services/openrouter/openrouterService';
import { scoreStoredReport, applyJudgeGate } from '../services/eval/scoreReport';
import { judgeReportQuality } from '../services/eval/reportQualityJudge';
import { buildCanonicalExecutionPlan } from '../services/planning/executionPlan';
import { getOrchestrationProfileForIntent } from '../services/planning/orchestrationProfiles';
import { scoreNoRepetition, stripGradeLines } from '../services/reasoning/baselineReport';

describe('baseline report pipeline', () => {
  beforeEach(() => {
    process.env.BASELINE_LAYER_ENABLED = 'true';
  });

  it('writes a switched-on report through the generator at the standard length', async () => {
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
    const headings = [...report.markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1]);
    expect(headings.some((heading) => heading.includes('When did the FDA'))).toBe(false);
    expect(headings.some((heading) => heading.includes('is described'))).toBe(false);
    expect(report.markdown).toContain('## Where sources disagree');
    expect(report.markdown).toContain('## Key findings');
    expect(report.markdown).toContain('## References');
    expect(report.markdown).toContain('1. US Food and Drug Administration. FDA Casgevy authorization. December 2023. https://www.fda.gov/casgevy');
    expect(report.markdown).not.toContain('When did the FDA authorize');
    expect(report.markdown).toContain('1 source was read');
    expect(report.markdown).not.toContain('About this report: About this report');
    expect(report.sections.find((section) => section.key === 'references')?.content).toContain('fda.gov');
    expect(report.markdown).toContain('[1]');
    const summary = report.sections.find((section) => section.key === 'summary')?.content ?? '';
    expect(summary.trim().split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(150);
    expect(scoreNoRepetition(report.sections)).toBe(1);
    const body = report.sections.map((section) => `## ${section.title}\n${section.content}`).join('\n\n');
    expect(report.markdown.endsWith(body)).toBe(true);
    expect(report.targetWordCount).toBe(2200);
    const judgment = await judgeReportQuality(report.markdown, async () => ({
      content: '{"answer_first":4,"readable_structure":4,"plain_neutral_prose":4,"citation_clarity":4,"honest_disagreement":4,"appropriate_length":4}',
      model: 'test',
      role: 'verifier',
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 1,
      usedFallback: false,
      primaryModel: 'test',
    }));
    const scores = applyJudgeGate(scoreStoredReport({ reportMarkdown: report.markdown, citations: [], reportQuality: judgment?.mean ?? null }), judgment);
    expect(scores.presentation_clean).toBe(1);
    expect(scores.report_quality).toBe(4);
    expect(scores.gate_status).not.toBe('verification_failed');
    const missed = applyJudgeGate(scoreStoredReport({ reportMarkdown: report.markdown, citations: [] }), null);
    expect(missed.gate_status).toBe('verification_failed');
    expect(stripGradeLines('Congressional testimony said the vote was public.\nStatistical inference was not required.')).toContain('Congressional testimony');
    const plan = buildCanonicalExecutionPlan({
      profile: getOrchestrationProfileForIntent('reference_lookup'),
    });
    expect(plan.skipReasons.discovery).toBe('Skipped by canonical intent profile.');
  });

  it('writes only the short answer when the plan fits a single fact', async () => {
    const report = await generateIterativeReport({
      query: 'When did the FDA authorize the first CRISPR therapy?',
      plan: {},
      sourceContext: 'The FDA authorized Casgevy in December 2023.',
      retrieverAnalysis: '',
      reasoningChains: '',
      challenges: '',
      intentId: 'factual_report',
      outputTemplateId: 'intent_factual_report',
      targetWordCount: 105,
      lengthSource: 'planner',
      skipChallenger: true,
      usedSources: [{ title: 'FDA Casgevy authorization', publisher: 'US Food and Drug Administration', date: 'December 2023', url: 'https://www.fda.gov/casgevy' }],
    });
    expect(report.targetWordCount).toBe(105);
    expect(report.sections.map((section) => section.title)).toEqual(['Summary', 'References', 'About this report']);
    const words = report.markdown.split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThan(200);
  });

  it.each([
    ['ranked_options', 'Ranked options'],
    ['narrative_briefing', 'Narrative briefing'],
    ['step_by_step_guide', 'Steps'],
    ['comparison_table', 'Comparison table'],
    ['structured_report', 'Structured report'],
  ] as const)('keeps the requested %s structure when the switch is on', async (format, heading) => {
    const report = await generateIterativeReport({
      query: 'When did the FDA authorize the first CRISPR therapy?',
      plan: {},
      sourceContext: 'The FDA authorized Casgevy in December 2023.',
      retrieverAnalysis: '',
      reasoningChains: '',
      challenges: '',
      intentId: 'factual_report',
      outputTemplateId: 'intent_factual_report',
      requestedFormats: [format],
      targetWordCount: 4000,
      skipChallenger: true,
      usedSources: [{ title: 'FDA Casgevy authorization', publisher: 'US Food and Drug Administration', date: 'December 2023', url: 'https://www.fda.gov/casgevy' }],
    });
    expect(report.markdown).toContain(`## ${heading}`);
    expect(report.markdown).toContain('## Who What When');
    expect(report.markdown).toContain('## Mechanism');
    expect(report.markdown).toContain('## Summary');
    expect(report.markdown).toContain('## References');
    expect(report.markdown).toContain('## About this report');
    expect(report.targetWordCount).toBe(4000);
    const summary = report.sections.find((section) => section.key === 'summary')?.content ?? '';
    expect(summary.trim().split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(150);
    if (format === 'comparison_table') expect(report.markdown).toContain('| Option | Note |');
  });

  it('matches the unset-flag report path and keeps the standard length', async () => {
    delete process.env.BASELINE_LAYER_ENABLED;
    vi.mocked(callRoleModel).mockClear();
    const report = await generateIterativeReport({
      query: 'When did the FDA authorize the first CRISPR therapy?',
      plan: {},
      sourceContext: 'The FDA authorized Casgevy in December 2023.',
      retrieverAnalysis: '',
      reasoningChains: '',
      challenges: '',
      intentId: 'factual_report',
      outputTemplateId: 'intent_factual_report',
      skipChallenger: true,
    });
    const outline = vi.mocked(callRoleModel).mock.calls.find((call) => String(call[0]?.messages?.[1]?.content).includes('Generate a report outline'));
    const draft = vi.mocked(callRoleModel).mock.calls.find((call) => String(call[0]?.messages?.[1]?.content).includes('Section to draft'));
    expect(String(outline?.[0]?.messages?.[1]?.content)).not.toContain('grammatical noun phrase');
    expect(String(draft?.[0]?.messages?.[1]?.content)).not.toContain('Do not mention section keys');
    expect(String(draft?.[0]?.messages?.[1]?.content)).not.toContain('CHUNK n');
    expect(report.markdown.startsWith('# ')).toBe(false);
    expect(report.targetWordCount).toBe(2200);
    expect(resolveReportWordTarget({ estimatedLength: { minWords: 60, maxWords: 150 } }).target).toBeLessThan(200);
  });
});
