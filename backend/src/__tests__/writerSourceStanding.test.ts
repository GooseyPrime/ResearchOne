/**
 * Slice 6, part 2. The writer is shown each source's standing in words and told
 * to prefer the higher one where sources disagree, saying so in plain words.
 * The standing never reaches the report: no number, no "Kind of source" line.
 * With the switch off the writer's prompt is what it always was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ role: string; text: string }> = [];
const firstDraftCitesUnknown = false;
const retryAlsoCitesUnknown = false;
const limitsRepeatsSummary = false;
const rewriteSwapsMarkers = false;
const summaryHasVerdict = false;

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(async (options: { role: string; messages: Array<{ role: string; content: string }> }) => {
    const text = options.messages.map((message) => message.content).join('\n');
    calls.push({ role: options.role, text });
    const reply = (content: string) => ({
      content,
      model: 'test',
      role: options.role,
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 1,
      usedFallback: false,
      primaryModel: 'test',
    });
    if (options.role === 'outline_architect') {
      return reply('{"title":"FDA authorization of Casgevy","outline":["Casgevy authorization","Eligible patient group"]}');
    }
    if (options.role === 'coherence_refiner' && rewriteSwapsMarkers && text.includes('Remove repeated sentences')) {
      // A rewrite that moves every citation of one passage onto another.
      return reply(options.messages[options.messages.length - 1].content.replace(/\[P1\]/g, '[P2]'));
    }
    if (options.role === 'coherence_refiner' && summaryHasVerdict && text.includes('plain encyclopedia prose')) {
      // A redraft that fixes the wording but moves a citation, so its section is put back.
      return reply(options.messages[options.messages.length - 1].content.replace(/verdict/gi, 'finding').replace(/\[P1\]/g, '[P2]'));
    }
    if (options.role !== 'section_drafter') return reply(text);
    const isRetry = options.messages.some((message) => message.content.includes('which you were not shown'));
    if (text.includes('Section to draft: Summary')) {
      if (summaryHasVerdict) return reply('The verdict of the agency was to authorize Casgevy on 8 December 2023 [P1].');
      return reply('The FDA authorized Casgevy on 8 December 2023 [P1]. It was the first therapy of its kind in the United States [P3].');
    }
    if (text.includes('Section to draft: Key findings')) {
      return reply('- The therapy edits a patient\'s own blood stem cells [P2].\n- A second regulator had authorized it weeks earlier [P3].');
    }
    if (text.includes('Section to draft: Where sources disagree')) return reply('The sources do not disagree.');
    if (text.includes('Section to draft: Limits of this report')) {
      return reply(limitsRepeatsSummary ? 'The FDA authorized Casgevy on 8 December 2023 [P1].' : 'This report rests on two sources.');
    }
    if (text.includes('Section to draft: Casgevy authorization')) {
      if (firstDraftCitesUnknown && !isRetry) return reply('The authorization covered patients aged 12 and older [P9].');
      if (retryAlsoCitesUnknown && isRetry) return reply('The authorization covered patients aged 12 and older [P9]. It followed a priority review [P1].');
      return reply('The authorization covered patients aged 12 and older [P1, P2].');
    }
    return reply('Eligible patients have recurrent vaso-occlusive crises [P2].');
  }),
  getSystemPrompt: () => 'Write the section.',
}));

import { cleanLayer1WordingForSave, generateIterativeReport, removeBannedWording } from '../services/reasoning/reportGenerator';
import { AUTHORITY_INSTRUCTION, formatLockedContext, issuePassages, STANDING_FOR_WRITER, type LockedPassage } from '../services/reasoning/citationLock';
import { readerFacingLabelHits, stripInternalLabelsFromReport } from '../services/formatting/reportPresentation';

const FDA = { title: 'FDA approves first gene therapies to treat sickle cell disease', publisher: 'US Food and Drug Administration', date: '2023-12-08', url: 'https://www.fda.gov/casgevy' };
const BLOG = { title: 'My take on the new therapy', publisher: 'someones-blog.example.com', url: 'https://someones-blog.example.com/x' };
const CHUNKS = [
  { id: '11111111-1111-4111-8111-111111111111', content: 'On 8 December 2023 the FDA authorized Casgevy for patients aged 12 and older.' },
  { id: '22222222-2222-4222-8222-222222222222', content: 'Casgevy edits a patient\'s own blood stem cells.' },
  { id: '33333333-3333-4333-8333-333333333333', content: 'A blogger says the authorization came in early December.' },
];

function passages(withStanding: boolean): LockedPassage[] {
  const issued = issuePassages(CHUNKS, [FDA, FDA, BLOG]);
  return withStanding ? issued.map((passage, i) => ({ ...passage, standing: i < 2 ? 1 : 4 })) : issued;
}

const write = (withStanding: boolean) =>
  generateIterativeReport({
    query: 'When did the FDA authorize the first CRISPR therapy?',
    plan: {},
    sourceContext: 'UNLOCKED',
    retrieverAnalysis: '',
    reasoningChains: '',
    challenges: '',
    intentId: 'factual_report',
    outputTemplateId: 'intent_factual_report',
    skipChallenger: true,
    targetWordCount: 2200,
    usedSources: [FDA, FDA, BLOG],
    lockedPassages: passages(withStanding),
  });

describe('the writer and source standing', () => {
  beforeEach(() => {
    process.env.BASELINE_LAYER_ENABLED = 'true';
    calls.length = 0;
  });
  afterEach(() => {
    delete process.env.BASELINE_LAYER_ENABLED;
  });

  it('shows each passage\'s standing in words and tells the writer how to use it', async () => {
    await write(true);
    const drafter = calls.filter((call) => call.role === 'section_drafter');
    expect(drafter.length).toBeGreaterThan(0);
    for (const call of drafter) {
      expect(call.text).toContain(`Kind of source: ${STANDING_FOR_WRITER[1]}`);
      expect(call.text).toContain(`Kind of source: ${STANDING_FOR_WRITER[4]}`);
      expect(call.text).toContain(AUTHORITY_INSTRUCTION);
      expect(call.text).not.toMatch(/\btier\s*[1-4]\b/i);
    }
  });

  it('leaves the writer\'s prompt as it was when no passage carries a standing', async () => {
    await write(false);
    for (const call of calls.filter((entry) => entry.role === 'section_drafter')) {
      expect(call.text).not.toContain('Kind of source');
      expect(call.text).not.toContain(AUTHORITY_INSTRUCTION);
    }
  });

  it('says to keep citing a lower source that is the only one for a point', () => {
    expect(AUTHORITY_INSTRUCTION).toMatch(/only one for a point is still used and cited/);
  });

  it('shows the standing on its own line between the source and the passage', () => {
    const text = formatLockedContext(passages(true).slice(2));
    expect(text.split('\n')).toEqual([
      '[P3] someones-blog.example.com, My take on the new therapy',
      `Kind of source: ${STANDING_FOR_WRITER[4]}`,
      'A blogger says the authorization came in early December.',
    ]);
  });

  it('takes a copied standing line out of the report, and only that', () => {
    const copied = [
      'The FDA authorized it in December [P1].',
      `Kind of source: ${STANDING_FOR_WRITER[1]}`,
      `- Kind of source: ${STANDING_FOR_WRITER[4]}`,
      `+ Kind of source: ${STANDING_FOR_WRITER[2]}.`,
      `2. Kind of source: ${STANDING_FOR_WRITER[3]}`,
      'It edits stem cells [P2].',
    ].join('\n');
    expect(stripInternalLabelsFromReport(copied)).toBe('The FDA authorized it in December [P1].\nIt edits stem cells [P2].');
    // A sentence of the report that begins the same way is kept.
    const prose = 'Kind of source: oral history interview conducted in 1990 [P1].';
    expect(stripInternalLabelsFromReport(prose)).toBe(prose);
    expect(stripInternalLabelsFromReport('This kind of source is rare.')).toBe('This kind of source is rare.');
    // A line that goes on past a link is prose, judged as one whole line.
    const linked = `Kind of source: ${STANDING_FOR_WRITER[2]} [article](https://example.org/article) on reactor safety [P1].`;
    expect(stripInternalLabelsFromReport(linked)).toBe(linked);
    // Inside fenced code nothing is removed.
    const code = ['```', `Kind of source: ${STANDING_FOR_WRITER[1]}`, '```'].join('\n');
    expect(stripInternalLabelsFromReport(code)).toBe(code);
  });

  it('describes each tier\'s whole group, never a narrower kind', () => {
    // A book or thesis is tier 3; the words for tier 3 must cover it.
    // Tier 3 includes DOI links of unknown kind: the words must not say they were not peer reviewed.
    expect(STANDING_FOR_WRITER[3]).toMatch(/not established as peer reviewed/);
    expect(AUTHORITY_INSTRUCTION).toMatch(/not established as peer reviewed/);
    expect(AUTHORITY_INSTRUCTION).not.toMatch(/that is not peer reviewed/);
    expect(STANDING_FOR_WRITER[3]).toMatch(/book/);
    expect(STANDING_FOR_WRITER[3]).toMatch(/thesis/);
    // Conference and review articles are tier 2: the words do not say "study".
    expect(STANDING_FOR_WRITER[2]).toBe('peer-reviewed scholarly work');
  });
});

describe('a source ranked by tier in the report text', () => {
  it('is a presentation failure, and ordinary uses of the word are not', () => {
    expect(readerFacingLabelHits('The regulator is a tier 1 source [P1].')).toContain('source rank');
    expect(readerFacingLabelHits('Two sources in tier 2 disagree.')).toContain('source rank');
    expect(readerFacingLabelHits('T1 evidence points the other way.')).toContain('source rank');
    expect(readerFacingLabelHits('Its authority level is high.')).toContain('source rank');
    expect(readerFacingLabelHits('Tier 2 cities grew fastest, and a tier 1 supplier failed.')).not.toContain('source rank');
    expect(readerFacingLabelHits('Run `tier 1 source` to test it.')).not.toContain('source rank');
    // A source quoted in its own words is left as it said it.
    expect(readerFacingLabelHits('The agency calls itself "a tier 1 source of data".')).not.toContain('source rank');
  });

  it('has a fallback that takes the rating out and keeps the sentence', () => {
    expect(removeBannedWording('The regulator is a tier 1 source [P1].')).toBe('The regulator is a source [P1].');
    expect(removeBannedWording('Two sources in tier 2 disagree.')).toBe('Two sources disagree.');
    expect(removeBannedWording('Tier 2 cities grew fastest.')).toBe('Tier 2 cities grew fastest.');
    // Every form the check flags is taken out, in any case.
    expect(removeBannedWording('t1 evidence points the other way.')).toBe('evidence points the other way.');
    expect(removeBannedWording('Its authority level is high.')).toBe('Its standing is high.');
    for (const text of ['The regulator is a tier 1 source.', 't1 evidence points the other way.', 'Its authority level is high.']) {
      expect(readerFacingLabelHits(removeBannedWording(text))).not.toContain('source rank');
    }
  });

  it('leaves a source\'s own words inside a quotation as it said them', () => {
    expect(removeBannedWording('The first is a tier 1 source; the agency calls itself "a tier 1 source of data".')).toBe(
      'The first is a source; the agency calls itself "a tier 1 source of data".'
    );
  });

  it('is cleaned in the last check before an unlocked report is saved', () => {
    const saved = cleanLayer1WordingForSave('## Findings\n\nThe regulator is a tier 1 source [1].');
    expect(saved.markdown).toContain('The regulator is a source [1].');
    expect(saved.wordingAfter).toEqual([]);
  });
});

describe('passages without a stated standing', () => {
  it('are not to be ranked or guessed at', () => {
    expect(AUTHORITY_INSTRUCTION).toMatch(/A passage without that line has no stated standing: do not guess one, and do not rank it/);
    expect(AUTHORITY_INSTRUCTION).not.toMatch(/^Each passage says/);
  });

  it('show no standing line, beside ranked ones that do', () => {
    const mixed = passages(true).map((passage, i) => (i === 2 ? { ...passage, standing: null } : passage));
    const text = formatLockedContext(mixed);
    expect(text.match(/Kind of source:/g)).toHaveLength(2);
  });
});

describe('copied standing lines and code', () => {
  it('leaves every form of code alone', () => {
    const line = `Kind of source: ${STANDING_FOR_WRITER[1]}`;
    const indented = `Text.\n\n    ${line}\n\nMore.`;
    expect(stripInternalLabelsFromReport(indented)).toBe(indented);
    const longFence = ['````', '```', line, '```', '````'].join('\n');
    expect(stripInternalLabelsFromReport(longFence)).toBe(longFence);
  });
});
