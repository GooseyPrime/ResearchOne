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
  getSystemPrompt: (_role: string, _isAdjudicative: boolean) => 'mock-system-prompt',
  buildVerifierPromptForIntent: (_intentId: string | undefined, _isAdjudicative: boolean) => 'mock-verifier-prompt',
}));

type RoleCall = {
  role: string;
  isAdjudicative?: boolean;
  baselineLayer?: boolean;
  messages: Array<{ role: string; content: string }>;
};

function roleCalls(): RoleCall[] {
  return callRoleModelMock.mock.calls.map((call) => call[0] as RoleCall);
}

/** A model that answers each role the way the writer expects, whatever order the calls come in. */
function answerByRole(subjectHeadings: string[]): void {
  callRoleModelMock.mockImplementation(async (call: RoleCall) => {
    if (call.role === 'outline_architect') {
      return { content: JSON.stringify({ title: 'Harbour dredging records', outline: subjectHeadings }) };
    }
    if (call.role === 'section_drafter') {
      const prompt = call.messages[1]?.content ?? '';
      return { content: prompt.startsWith('Section to draft: Key findings') ? '- One finding.\n- A second finding.\n- A third finding.' : 'Section body text' };
    }
    if (call.role === 'internal_challenger') return { content: '- challenge points' };
    return { content: 'not labelled blocks' };
  });
}

const READER_OPENING = ['Summary', 'Key findings'];
const READER_CLOSING = ['Where sources disagree', 'Limits of this report'];
/** Added by the system after the drafted sections; no source was used, so there is no References section. */
const SYSTEM_CLOSING = 'About this report';
const OLD_LAYOUT = /falsification|contradiction analysis|evidence ledger|unresolved questions|executive summary|supporting detail/i;

describe('iterative report generator', () => {
  beforeEach(() => {
    callRoleModelMock.mockReset();
  });

  it('emits per-section progress and returns markdown in the reader layout', async () => {
    answerByRole(['Dredging schedule and depth', 'Sediment disposal sites']);

    const progress = vi.fn();
    const { generateIterativeReport, OUTLINE_HEADING_INSTRUCTION } = await import('../services/reasoning/reportGenerator');

    const result = await generateIterativeReport({
      query: 'Test query',
      plan: {},
      sourceContext: 'evidence',
      retrieverAnalysis: 'analysis',
      reasoningChains: 'reasoning',
      challenges: 'challenges',
      requestedFormats: ['ranked_options'],
      onSectionProgress: progress,
    });

    // Summary, Key findings, two subject sections, the requested ranked
    // options, then the two closing sections. Progress is reported for the
    // sections the writer drafts.
    const titles = [
      ...READER_OPENING,
      'Dredging schedule and depth',
      'Sediment disposal sites',
      'Ranked options',
      ...READER_CLOSING,
    ];
    expect(result.sections.map((section) => section.title)).toEqual([...titles, SYSTEM_CLOSING]);
    expect(result.sections.map((section) => section.key)).toEqual([
      'summary',
      'key_findings',
      'topic_0',
      'topic_1',
      'ranked_options',
      'disagreement',
      'limits',
      'about',
    ]);
    expect(progress).toHaveBeenCalledTimes(titles.length);
    expect(progress.mock.calls.map((call) => (call[0] as { title: string }).title)).toEqual(titles);
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.markdown).not.toMatch(OLD_LAYOUT);

    const outlinePrompt = roleCalls()[0]?.messages[1]?.content ?? '';
    expect(outlinePrompt).toContain('Requested presentation formats:');
    expect(outlinePrompt).toContain('- ranked_options');
    expect(outlinePrompt).toContain(OUTLINE_HEADING_INSTRUCTION);
    expect(outlinePrompt).not.toMatch(OLD_LAYOUT);
  });

  it('writes an adjudicative report to the same layout, with Layer 1 handling on every writer call', async () => {
    answerByRole(['Dredging schedule and depth', 'Sediment disposal sites']);

    const { generateIterativeReport } = await import('../services/reasoning/reportGenerator');
    const result = await generateIterativeReport({
      query: 'Test query',
      plan: {},
      sourceContext: 'evidence',
      retrieverAnalysis: 'analysis',
      reasoningChains: 'reasoning',
      challenges: 'challenges',
      intentId: 'adjudication',
      outputTemplateId: 'intent_adjudication',
      isAdjudicative: true,
      skipChallenger: true,
    });

    expect(result.sections.map((section) => section.title)).toEqual([
      ...READER_OPENING,
      'Dredging schedule and depth',
      'Sediment disposal sites',
      ...READER_CLOSING,
      SYSTEM_CLOSING,
    ]);
    expect(result.markdown).not.toMatch(OLD_LAYOUT);

    const calls = roleCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.isAdjudicative).toBe(false);
      expect(call.baselineLayer).toBe(true);
    }
    const drafter = calls.find((call) => call.role === 'section_drafter');
    expect(drafter?.messages[1]?.content).toContain('Notes from the check of the reasoning: challenges');
    expect(drafter?.messages[1]?.content).not.toContain('Double-check output:');
    const refiner = calls.find((call) => call.role === 'coherence_refiner');
    expect(refiner?.messages[1]?.content.startsWith('Refine the report text. Keep every fact and every citation as it is.')).toBe(true);
    expect(refiner?.messages[1]?.content).toContain('Never lengthen a section and never add material');
  });

  it('throws when a known non-legacy intent is missing outputTemplateId', async () => {
    const { generateIterativeReport } = await import('../services/reasoning/reportGenerator');

    await expect(
      generateIterativeReport({
        query: 'Test query',
        plan: {},
        sourceContext: 'evidence',
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
        sourceContext: 'evidence',
        retrieverAnalysis: 'analysis',
        reasoningChains: 'reasoning',
        challenges: 'challenges',
        intentId: 'implementation',
        outputTemplateId: 'intent_opportunity_discovery',
      })
    ).rejects.toThrow(/INTENT_TEMPLATE_MISMATCH/);
  });

  it('takes guidance, not headings, from the opportunity discovery template', async () => {
    // The outline step may answer with the template's old headings; structural
    // labels among them are not accepted as subject headings.
    answerByRole(['Overview', 'Opportunities in coastal freight', 'Viability of each route', 'Caveats']);

    const { generateIterativeReport } = await import('../services/reasoning/reportGenerator');
    const { getIntentOutputTemplate } = await import('../services/formatting/templates/intentOutputTemplates');
    const result = await generateIterativeReport({
      query: 'opportunity query',
      plan: {},
      sourceContext: 'evidence',
      retrieverAnalysis: 'analysis',
      reasoningChains: 'reasoning',
      challenges: 'challenges',
      intentId: 'opportunity_discovery',
      outputTemplateId: 'intent_opportunity_discovery',
    });

    expect(result.sections.map((section) => section.key)).toEqual([
      'summary',
      'key_findings',
      'topic_0',
      'topic_1',
      'disagreement',
      'limits',
      'about',
    ]);
    expect(result.sections.map((section) => section.title)).toEqual([
      ...READER_OPENING,
      'Opportunities in coastal freight',
      'Viability of each route',
      ...READER_CLOSING,
      SYSTEM_CLOSING,
    ]);

    const template = getIntentOutputTemplate('intent_opportunity_discovery');
    const outlinePrompt = roleCalls()[0]?.messages[1]?.content ?? '';
    expect(template.narrativeHint.length).toBeGreaterThan(0);
    expect(outlinePrompt).toContain(template.narrativeHint);
    expect(outlinePrompt).toContain(
      'Required sections:\n- Summary\n- Key findings\n- Pending subject\n- Pending subject\n- Where sources disagree\n- Limits of this report'
    );
  });
});
