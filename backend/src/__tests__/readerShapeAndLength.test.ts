/**
 * What the first live sample reports got wrong, driven through the real report
 * writer with the model replaced: sections far past their share, key findings
 * written as an essay, a limits note of many paragraphs, a sentence cut at
 * "et al.", and wording the reader standard bans.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ role: string; text: string; last: string }> = [];
let keyFindingsAsParagraph = false;
let shortenWorks = true;
let bodyIsLong = false;

const sentence = (n: number, marker: string) => `Finding number ${n} adds one more separate detail about the construction programme ${marker}.`;
const LONG_BODY = Array.from({ length: 120 }, (_, index) => sentence(index + 1, '[P2]')).join(' ');
const SHORT_BODY = Array.from({ length: 6 }, (_, index) => sentence(index + 1, '[P2]')).join(' ');
const TAIL = 'reporting that costs fell by half between the first reactor and the later builds [P3].';

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(async (options: { role: string; messages: Array<{ role: string; content: string }> }) => {
    const text = options.messages.map((message) => message.content).join('\n');
    const last = options.messages[options.messages.length - 1].content;
    calls.push({ role: options.role, text, last });
    const reply = (content: string) => ({ content, model: 'test', role: options.role, promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' });
    if (options.role === 'outline_architect') return reply('{"title":"Nuclear construction costs by country","outline":["Regulatory change during construction","Standard designs built in series"]}');
    if (options.role !== 'section_drafter') return reply(last);
    const first = options.messages[1].content;
    const asksBullets = last.startsWith('Rewrite this as 3 to 7 bullet points');
    const asksShorter = last.startsWith('That draft is');
    if (first.includes('Section to draft: Summary')) return reply('Costs rose in the United States after 1979 [P1].');
    if (first.includes('Section to draft: Key findings')) {
      if (keyFindingsAsParagraph && !asksBullets) return reply('The comparative analysis reveals three factors. Regulation changed during construction [P1]. Designs were not repeated [P2].');
      return reply(Array.from({ length: 9 }, (_, index) => `- Point ${index + 1} about the programme is stated once here [P1].`).join('\n'));
    }
    if (first.includes('Section to draft: Regulatory change during construction')) {
      if (bodyIsLong && !(asksShorter && shortenWorks)) return reply(LONG_BODY);
      return reply(SHORT_BODY);
    }
    if (first.includes('Section to draft: Standard designs built in series')) {
      return reply(`Reporting that costs fell by half between the first reactor and the later builds [P3]. Later work repeated one design many times over two decades [P2].`);
    }
    if (first.includes('Section to draft: Where sources disagree')) {
      return reply(`The record is contested, with Lovering et al. ${TAIL} Critics claim that the figures were estimates and not final costs [P1].`);
    }
    if (first.includes('Section to draft: Limits of this report')) {
      return reply(Array.from({ length: 7 }, (_, index) => `Limit number ${index + 1} names a separate gap in what the sources cover.`).join(' '));
    }
    if (first.includes('Section to draft: Steps')) {
      return reply(Array.from({ length: 150 }, (_, index) => `${index + 1}. Carry out step ${index + 1} of the procedure exactly as the manual describes it [P2].`).join('\n'));
    }
    return reply('Nothing further.');
  }),
  getSystemPrompt: () => 'Write the section.',
}));

import { generateIterativeReport } from '../services/reasoning/reportGenerator';
import { issuePassages } from '../services/reasoning/citationLock';
import { firstSentences, isBulletList, isSizedReaderSection, readerSectionBudgets, splitSentences, trimToWords, wordCount, removeRepeatedSentences } from '../services/reasoning/baselineReport';
import { readerFacingLabelHits } from '../services/formatting/reportPresentation';

const SOURCE = { title: 'Nuclear construction cost study', publisher: 'Energy Policy', date: '2016-04-01', url: 'https://example.org/study' };
const CHUNKS = [
  { id: '11111111-1111-4111-8111-111111111111', content: 'After 1979 United States construction costs rose sharply.' },
  { id: '22222222-2222-4222-8222-222222222222', content: 'France built one design many times over two decades.' },
  { id: '33333333-3333-4333-8333-333333333333', content: 'Korean costs fell by half between the first reactor and the later builds.' },
];

async function write(lock = true) {
  return generateIterativeReport({
    query: 'Why do nuclear plants cost more to build in the United States?',
    plan: {},
    sourceContext: 'context',
    retrieverAnalysis: '',
    reasoningChains: '',
    challenges: '',
    intentId: 'factual_report',
    outputTemplateId: 'intent_factual_report',
    skipChallenger: true,
    targetWordCount: 2200,
    lengthSource: 'planner',
    usedSources: [SOURCE, SOURCE, SOURCE],
    lockedPassages: lock ? issuePassages(CHUNKS, [SOURCE, SOURCE, SOURCE]) : undefined,
  });
}

const section = (report: Awaited<ReturnType<typeof write>>, key: string): string => report.sections.find((entry) => entry.key === key)?.content ?? '';
const drafterCallFor = (title: string) => calls.find((call) => call.role === 'section_drafter' && call.text.includes(`Section to draft: ${title}`));

describe('section size and shape on the Layer 1 report path', () => {
  beforeEach(() => {
    process.env.BASELINE_LAYER_ENABLED = 'true';
    calls.length = 0;
    keyFindingsAsParagraph = false;
    shortenWorks = true;
    bodyIsLong = false;
  });
  afterEach(() => {
    delete process.env.BASELINE_LAYER_ENABLED;
  });

  it('gives the summary, key findings and limits their own size, and the subject sections the rest', async () => {
    await write();
    expect(drafterCallFor('Summary')?.text).toContain('This section ("Summary") target: ~150 words');
    expect(drafterCallFor('Key findings')?.text).toContain('target: ~180 words');
    expect(drafterCallFor('Limits of this report')?.text).toContain('target: ~90 words');
    // 2,200 words less the four fixed sections (640), shared by two subject sections.
    expect(drafterCallFor('Regulatory change during construction')?.text).toContain('target: ~780 words');
  });

  it('tells the writer what key findings and limits must look like', async () => {
    await write();
    expect(drafterCallFor('Key findings')?.text).toContain('Write 3 to 7 bullet points and nothing else.');
    expect(drafterCallFor('Limits of this report')?.text).toContain('Write two to four sentences that name only real limits');
    expect(drafterCallFor('Regulatory change during construction')?.text).toContain('Do not retell them');
    expect(drafterCallFor('Summary')?.text).toContain('Never use the words claim or claims');
  });

  it('asks once for bullets when key findings come back as paragraphs, and keeps at most seven', async () => {
    keyFindingsAsParagraph = true;
    const report = await write();
    const asks = calls.filter((call) => call.last.startsWith('Rewrite this as 3 to 7 bullet points'));
    expect(asks).toHaveLength(1);
    const findings = section(report, 'key_findings');
    expect(isBulletList(findings)).toBe(true);
    expect(findings.split('\n')).toHaveLength(7);
  });

  it('keeps at most seven bullets when the first draft is already a list, without asking again', async () => {
    const report = await write();
    expect(calls.some((call) => call.last.startsWith('Rewrite this as 3 to 7 bullet points'))).toBe(false);
    expect(section(report, 'key_findings').split('\n')).toHaveLength(7);
  });

  it('asks once for a shorter draft when a section runs far past its share, and uses it', async () => {
    bodyIsLong = true;
    const report = await write();
    const asks = calls.filter((call) => call.last.startsWith('That draft is'));
    expect(asks).toHaveLength(1);
    expect(asks[0].last).toContain('Rewrite it within 780 words');
    expect(wordCount(section(report, 'topic_0'))).toBe(wordCount(SHORT_BODY));
  });

  it('cuts a section that is still far too long at a sentence, keeping each citation with its sentence', async () => {
    bodyIsLong = true;
    shortenWorks = false;
    const report = await write();
    const body = section(report, 'topic_0');
    expect(wordCount(LONG_BODY)).toBeGreaterThan(1053);
    expect(wordCount(body)).toBeLessThanOrEqual(1053);
    expect(wordCount(body)).toBeGreaterThan(900);
    // Whole sentences only: the text ends with a citation and a full stop, and every sentence still carries its marker.
    expect(body.endsWith('[P2].')).toBe(true);
    expect(splitSentences(body).every((piece) => piece.includes('[P2]'))).toBe(true);
  });

  it('keeps the limits note to four sentences', async () => {
    const report = await write();
    const limits = section(report, 'limits');
    expect(splitSentences(limits)).toHaveLength(4);
    expect(limits).toContain('Limit number 1 ');
    expect(limits).not.toContain('Limit number 5 ');
  });

  it('does not cut a sentence at "et al." when its second half repeats an earlier sentence', async () => {
    const report = await write();
    const disagreement = section(report, 'disagreement');
    expect(disagreement).toContain(`with Lovering et al. ${TAIL}`);
    expect(disagreement).not.toMatch(/et al\.\s+Critics/);
  });

  it('puts "claim" into plain words when the redraft cannot, and leaves no banned wording', async () => {
    const report = await write();
    expect(calls.some((call) => call.text.includes('Rewrite the report in plain encyclopedia prose'))).toBe(true);
    expect(section(report, 'disagreement')).toContain('Critics state that the figures were estimates');
    expect(readerFacingLabelHits(report.markdown).filter((hit) => hit !== 'passage marker')).toEqual([]);
  });

  it('does not shorten the steps of a how-to, however many there are', async () => {
    const report = await generateIterativeReport({
      query: 'How is the pump serviced?',
      plan: {},
      sourceContext: 'context',
      retrieverAnalysis: '',
      reasoningChains: '',
      challenges: '',
      intentId: 'how_to',
      outputTemplateId: 'intent_how_to',
      skipChallenger: true,
      targetWordCount: 600,
      lengthSource: 'planner',
      usedSources: [SOURCE, SOURCE, SOURCE],
      lockedPassages: issuePassages(CHUNKS, [SOURCE, SOURCE, SOURCE]),
    });
    const steps = report.sections.find((entry) => entry.key === 'steps')?.content ?? '';
    expect(steps.split('\n')).toHaveLength(150);
    expect(calls.some((call) => call.last.startsWith('That draft is') && call.text.includes('Section to draft: Steps'))).toBe(false);
  });

  it('tells the refiner never to lengthen a Layer 1 report', async () => {
    await write();
    const refiner = calls.find((call) => call.role === 'coherence_refiner' && call.text.includes('Refine report text'));
    expect(refiner?.text).toContain('Never lengthen a section and never add material.');
    expect(refiner?.text).not.toContain('extend it with substantive analysis');
  });

  it('changes nothing with the Layer 1 switch off', async () => {
    delete process.env.BASELINE_LAYER_ENABLED;
    bodyIsLong = true;
    keyFindingsAsParagraph = true;
    await write(false);
    expect(calls.some((call) => call.last.startsWith('That draft is') || call.last.startsWith('Rewrite this as 3 to 7'))).toBe(false);
    const drafter = calls.filter((call) => call.role === 'section_drafter');
    expect(drafter.length).toBeGreaterThan(0);
    for (const call of drafter) {
      expect(call.text).not.toContain('Write 3 to 7 bullet points');
      expect(call.text).not.toContain('Never use the words claim or claims');
    }
    const refiner = calls.find((call) => call.role === 'coherence_refiner' && call.text.includes('Refine report text'));
    expect(refiner?.text).toContain('extend it with substantive analysis from the challenger findings rather than padding.');
  });
});

describe('helpers behind section size and shape', () => {
  it('never lets the fixed sections take more than two fifths of a short report', () => {
    const plan = [{ key: 'summary' }, { key: 'key_findings' }, { key: 'topic_0' }, { key: 'disagreement' }, { key: 'limits' }];
    const budgets = readerSectionBudgets(600, plan);
    const fixed = (budgets.get('summary') ?? 0) + (budgets.get('key_findings') ?? 0) + (budgets.get('disagreement') ?? 0) + (budgets.get('limits') ?? 0);
    expect(fixed).toBeLessThanOrEqual(242);
    expect(budgets.get('topic_0')).toBe(360);
  });

  it('sizes a summary-only report to the summary', () => {
    expect(readerSectionBudgets(120, [{ key: 'summary' }]).get('summary')).toBe(120);
    expect(readerSectionBudgets(900, [{ key: 'summary' }]).get('summary')).toBe(150);
  });

  it('does not split where the next word cannot start a sentence', () => {
    expect(splitSentences('The record is mixed, with Lovering et al. reporting a fall. Critics disagree.')).toEqual(['The record is mixed, with Lovering et al. reporting a fall.', 'Critics disagree.']);
    expect(splitSentences('See the 2012 audit. it covers 58 reactors.')).toEqual(['See the 2012 audit. it covers 58 reactors.']);
  });

  it('does not split after a title, a reference word or an initial before a name', () => {
    expect(splitSentences('The review by Dr. Chen covers Fig. 3 in full. It is short.')).toEqual(['The review by Dr. Chen covers Fig. 3 in full.', 'It is short.']);
    expect(splitSentences('The study by J. R. Lovering covers 349 reactors. It is cited often.')).toEqual(['The study by J. R. Lovering covers 349 reactors.', 'It is cited often.']);
    expect(splitSentences('Costs differ by country, e.g. France and Korea. Both built in series.')).toEqual(['Costs differ by country, e.g. France and Korea.', 'Both built in series.']);
  });

  it('does not split "et al." or a dotted abbreviation from the number or bracket after it', () => {
    expect(splitSentences('Lovering et al. (2016) cover 349 reactors. Grubler covers France.')).toEqual(['Lovering et al. (2016) cover 349 reactors.', 'Grubler covers France.']);
    expect(splitSentences('Costs rose in the U.S. [3] after 1979. They fell in Korea.')).toEqual(['Costs rose in the U.S. [3] after 1979.', 'They fell in Korea.']);
  });

  it('still ends a sentence at an abbreviation when a new sentence follows', () => {
    // A real boundary: merging here would hide a sentence from the four-sentence cap and the repetition check.
    expect(splitSentences('It was built in the U.S. Later units cost more.')).toEqual(['It was built in the U.S.', 'Later units cost more.']);
    expect(splitSentences('The supplier is Acme Inc. Revenue rose.')).toEqual(['The supplier is Acme Inc.', 'Revenue rose.']);
    expect(splitSentences('The data are from Smith et al. Coverage ends in 2020.')).toEqual(['The data are from Smith et al.', 'Coverage ends in 2020.']);
    expect(splitSentences('First point. Second point.')).toEqual(['First point.', 'Second point.']);
  });

  it('counts a sentence that ends in an abbreviation toward the limits cap', () => {
    const limits = 'The data are from Smith et al. Coverage ends in 2020. No cost data are given for Korea. Labour figures are missing. A fifth sentence must go.';
    expect(firstSentences(limits, 4)).toBe('The data are from Smith et al. Coverage ends in 2020. No cost data are given for Korea. Labour figures are missing.');
  });

  it('still splits text in a script without letter case at every full stop', () => {
    expect(splitSentences('これは最初の文です. これは次の文です.')).toHaveLength(2);
  });

  it('removes a repeated whole sentence but not the second half of a longer one', () => {
    const tail = 'reporting that costs fell by half between the first reactor and the later builds.';
    const out = removeRepeatedSentences([
      { content: `Reporting that costs fell by half between the first reactor and the later builds.` },
      { content: `The record is contested, with Lovering et al. ${tail} A second sentence follows here to be kept in place.` },
      { content: `Reporting that costs fell by half between the first reactor and the later builds. Another sentence that is new and long enough to keep.` },
    ]);
    expect(out[1].content).toContain(`with Lovering et al. ${tail}`);
    expect(out[2].content).toBe('Another sentence that is new and long enough to keep.');
  });

  it('keeps a table whole and always keeps the opening sentence when trimming', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |';
    expect(trimToWords(`One two three four five. Six seven eight nine ten.\n\n${table}`, 6)).toBe('One two three four five.');
    expect(trimToWords('One two three four five six seven eight.', 3)).toBe('One two three four five six seven eight.');
    expect(trimToWords(`Short opening line.\n\n${table}`, 30)).toBe(`Short opening line.\n\n${table}`);
    expect(trimToWords('- first bullet here\n- second bullet here\n- third bullet here', 8)).toBe('- first bullet here\n- second bullet here');
  });

  it('never drops a table to make a section shorter', () => {
    const table = '| reactor | months |\n| - | - |\n| A | 65 |\n| B | 90 |';
    expect(trimToWords(`One two three four five.\n\n${table}\n\nA closing paragraph that is dropped.`, 8)).toBe(`One two three four five.\n\n${table}`);
  });

  it('holds only the sections whose length is the writer\'s to manage', () => {
    for (const key of ['key_findings', 'limits', 'disagreement', 'established', 'contested', 'open_questions', 'topic_0', 'topic_12']) {
      expect(isSizedReaderSection(key)).toBe(true);
    }
    // The summary has its own 150-word rule; steps, a comparison table and sections a request named are not cut.
    for (const key of ['summary', 'steps', 'comparison', 'item_3', 'ranked_options', 'cross_opportunity_analysis']) {
      expect(isSizedReaderSection(key)).toBe(false);
    }
  });
});
