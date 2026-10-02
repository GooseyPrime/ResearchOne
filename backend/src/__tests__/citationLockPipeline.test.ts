import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ role: string; text: string }> = [];
let firstDraftCitesUnknown = false;
let retryAlsoCitesUnknown = false;
let limitsRepeatsSummary = false;
let rewriteSwapsMarkers = false;

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
    if (options.role !== 'section_drafter') return reply(text);
    const isRetry = options.messages.some((message) => message.content.includes('which you were not shown'));
    if (text.includes('Section to draft: Summary')) {
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

import { generateIterativeReport } from '../services/reasoning/reportGenerator';
import { sentenceKey } from '../services/reasoning/baselineReport';
import {
  assignOccurrencesToSections,
  bestQuote,
  countShortfallSetsStatus,
  finalizeLockedCitations,
  formatLockedContext,
  issuePassages,
  keepRewritesThatPreserveMarkers,
  markersIn,
  markersPreserved,
  unknownMarkers,
  stripReaderNumbers,
  stripUnknownMarkers,
  stripUnsupportedMarkers,
  passagesForSection,
  readerNumbersIn,
  rebindRevisedCitations,
  renumberAfterRevision,
  type LockedPassage,
} from '../services/reasoning/citationLock';
import { scoreCitationBound, scoreQuoteVerbatim } from '../services/eval/scoreReport';
import { readerFacingLabelHits, stripInternalLabelsFromReport } from '../services/formatting/reportPresentation';

const FDA = { title: 'FDA approves first gene therapies to treat sickle cell disease', publisher: 'US Food and Drug Administration', date: '2023-12-08', url: 'https://www.fda.gov/casgevy' };
const MHRA = { title: 'MHRA authorises gene therapy', publisher: 'Medicines and Healthcare products Regulatory Agency', date: '2023-11-16', url: 'https://www.gov.uk/mhra-casgevy' };

const CHUNKS = [
  { id: '11111111-1111-4111-8111-111111111111', content: 'Today the agency acted.  On 8 December 2023 the FDA authorized Casgevy for patients aged 12 and older. The application received priority review.' },
  { id: '22222222-2222-4222-8222-222222222222', content: 'Casgevy edits a patient\'s own blood stem cells. Eligible patients have recurrent vaso-occlusive crises.' },
  { id: '33333333-3333-4333-8333-333333333333', content: 'The United Kingdom regulator authorized the therapy on 16 November 2023, weeks before the United States.' },
];
const SOURCES = [FDA, FDA, MHRA];

function passages(): LockedPassage[] {
  return issuePassages(CHUNKS, SOURCES);
}

async function writeLocked() {
  return generateIterativeReport({
    query: 'When did the FDA authorize the first CRISPR therapy?',
    plan: {},
    sourceContext: 'UNLOCKED-CONTEXT-SENTINEL',
    retrieverAnalysis: '',
    reasoningChains: '',
    challenges: '',
    intentId: 'factual_report',
    outputTemplateId: 'intent_factual_report',
    skipChallenger: true,
    targetWordCount: 2200,
    usedSources: SOURCES,
    lockedPassages: passages(),
  });
}

function sectionsOf(markdown: string): Array<{ title: string; content: string }> {
  const out: Array<{ title: string; content: string }> = [];
  for (const block of markdown.split(/^(?=#{1,3}\s)/m)) {
    const [heading, ...rest] = block.split('\n');
    out.push({ title: heading.replace(/^#+\s*/, '').trim(), content: rest.join('\n').trim() });
  }
  return out;
}

describe('citation lock on the report path', () => {
  beforeEach(() => {
    process.env.BASELINE_LAYER_ENABLED = 'true';
    calls.length = 0;
    firstDraftCitesUnknown = false;
    retryAlsoCitesUnknown = false;
    limitsRepeatsSummary = false;
    rewriteSwapsMarkers = false;
  });
  afterEach(() => {
    delete process.env.BASELINE_LAYER_ENABLED;
  });

  it('shows the writer whole passages under markers, not the unlocked context', async () => {
    await writeLocked();
    const drafter = calls.filter((call) => call.role === 'section_drafter');
    expect(drafter.length).toBeGreaterThan(0);
    for (const call of drafter) {
      expect(call.text).not.toContain('UNLOCKED-CONTEXT-SENTINEL');
      expect(call.text).toContain('[P1] US Food and Drug Administration');
      expect(call.text).toContain('The application received priority review.');
      expect(call.text).toContain('Cite with the markers shown above and no others.');
      expect(call.text).not.toContain('A sentence drawn from CHUNK n');
    }
  });

  it('leaves markers in the generated text and adds no reference list of its own', async () => {
    const report = await writeLocked();
    expect(report.markdown).toContain('[P1]');
    expect(report.markdown).not.toContain('## References');
    expect(report.markdown).not.toContain('## About this report');
    expect(report.citationIssues).toEqual([]);
    // The markers are deliberate at this point and must not trigger a rewrite of the whole report.
    expect(calls.some((call) => call.text.includes('Rewrite the report in plain encyclopedia prose'))).toBe(false);
  });

  it('numbers by source in first-citation order and ties every citation to a word-for-word quote', async () => {
    const report = await writeLocked();
    const finalized = finalizeLockedCitations(report.markdown, passages(), '2 Oct 2026');

    expect(finalized.markdown).not.toMatch(/\[P\d+/);
    expect(readerFacingLabelHits(finalized.markdown)).toEqual([]);
    expect(finalized.markdown).toContain('8 December 2023 [1]. It was the first therapy of its kind in the United States [2].');
    // Two passages from one source share its number.
    expect(finalized.markdown).toContain('aged 12 and older [1][1].');
    const references = finalized.markdown.split('## References\n')[1].split('\n\n## About this report')[0].split('\n');
    expect(references).toEqual([
      '1. US Food and Drug Administration, FDA approves first gene therapies to treat sickle cell disease, 2023-12-08 https://www.fda.gov/casgevy',
      '2. Medicines and Healthcare products Regulatory Agency, MHRA authorises gene therapy, 2023-11-16 https://www.gov.uk/mhra-casgevy',
    ]);
    expect(finalized.markdown.trimEnd().endsWith('2 sources were read on 2 Oct 2026.')).toBe(true);

    const markersInText = finalized.markdown.split('## References')[0].match(/\[\d+\]/g) ?? [];
    expect(finalized.occurrences).toHaveLength(markersInText.length);
    const byChunk = new Map(CHUNKS.map((chunk) => [chunk.id, chunk.content]));
    for (const occurrence of finalized.occurrences) {
      expect(byChunk.get(occurrence.chunkId)).toContain(occurrence.quote);
      expect(occurrence.quote.length).toBeGreaterThan(0);
    }

    const stored = finalized.occurrences.map((occurrence) => ({
      alias: `[${occurrence.number}]`,
      chunkQuote: occurrence.quote,
      chunkText: byChunk.get(occurrence.chunkId) ?? '',
      chunkId: occurrence.chunkId,
      citationText: `[${occurrence.number}]`,
      claimText: null,
    }));
    expect(scoreCitationBound(finalized.markdown, stored)).toBe(1);
    // The harness scores a locked run on this branch: each number in the prose
    // must be backed, in order, by a saved row with a passage and a quote.
    expect(scoreCitationBound(finalized.markdown, stored, true)).toBe(1);
    expect(scoreCitationBound(finalized.markdown, stored.slice(1), true)).toBeLessThan(1);
    // An alias-shaped token in a code sample does not switch the scorer to aliases.
    expect(scoreCitationBound(`${finalized.markdown}\n\n\`\`\`\nrows[E1]\n\`\`\``, stored, true)).toBe(1);
    expect(scoreCitationBound(finalized.markdown, stored.map((row) => ({ ...row, chunkQuote: '' })), true)).toBe(0);
    expect(scoreQuoteVerbatim(stored)).toBe(1);
  });

  it('places each citation in the section it appears in', async () => {
    const report = await writeLocked();
    const finalized = finalizeLockedCitations(report.markdown, passages(), '2 Oct 2026');
    const sections = sectionsOf(finalized.markdown);
    const bound = assignOccurrencesToSections(sections, finalized.occurrences);
    expect(bound).toHaveLength(finalized.occurrences.length);
    expect(bound.every((row) => row.sectionOrder != null)).toBe(true);
    expect(bound.map((row) => row.order)).toEqual(bound.map((_, index) => index + 1));
    const summaryOrder = sections.findIndex((section) => section.title === 'Summary') + 1;
    expect(bound.filter((row) => row.sectionOrder === summaryOrder).map((row) => row.number)).toEqual([1, 2]);
    const referencesOrder = sections.findIndex((section) => section.title === 'References') + 1;
    expect(bound.some((row) => row.sectionOrder === referencesOrder)).toBe(false);
  });

  it('drafts a section again when it cites a marker it was not shown', async () => {
    firstDraftCitesUnknown = true;
    const report = await writeLocked();
    const retries = calls.filter((call) => call.text.includes('which you were not shown'));
    expect(retries).toHaveLength(1);
    expect(retries[0].text).toContain('[P9]');
    expect(report.markdown).not.toContain('[P9]');
    expect(report.citationIssues).toEqual([]);
  });

  it('removes a marker that survives the second draft, keeps the sentence, and reports it', async () => {
    firstDraftCitesUnknown = true;
    retryAlsoCitesUnknown = true;
    const report = await writeLocked();
    expect(report.markdown).not.toContain('[P9]');
    expect(report.markdown).toContain('The authorization covered patients aged 12 and older. It followed a priority review [P1].');
    expect(report.citationIssues).toEqual([{ section: 'Casgevy authorization', markers: ['P9'] }]);
  });

  it('rejects a rewrite that moves a citation to a different passage', async () => {
    limitsRepeatsSummary = true;
    rewriteSwapsMarkers = true;
    const report = await writeLocked();
    expect(calls.some((call) => call.role === 'coherence_refiner' && call.text.includes('Remove repeated sentences'))).toBe(true);
    expect(report.markdown).toContain('The FDA authorized Casgevy on 8 December 2023 [P1].');
    expect(report.markdown).not.toContain('8 December 2023 [P2]');
  });

  it('ignores locked passages when the Layer 1 switch is off', async () => {
    delete process.env.BASELINE_LAYER_ENABLED;
    await writeLocked();
    const drafter = calls.filter((call) => call.role === 'section_drafter');
    expect(drafter.length).toBeGreaterThan(0);
    for (const call of drafter) {
      expect(call.text).toContain('UNLOCKED-CONTEXT-SENTINEL');
      expect(call.text).not.toContain('Cite with the markers shown above');
    }
  });
});

describe('citation lock helpers', () => {
  it('shows every passage while they fit, and the closest ones when they do not', () => {
    const many = issuePassages(
      Array.from({ length: 20 }, (_, index) => ({
        id: `chunk-${index}`,
        content: index === 17 ? 'Retraction notices for gene therapy trials were issued in 2021.' : `Filler passage number ${index} about unrelated shipping schedules.`,
      })),
      Array.from({ length: 20 }, (_, index) => ({ title: `Source ${index}`, url: `https://example.org/${index}` }))
    );
    expect(passagesForSection(many, ['Retraction notices', 'gene therapy'], { broad: false })).toHaveLength(20);
    const narrowed = passagesForSection(many, ['Retraction notices', 'gene therapy'], { broad: false, budget: 400 });
    expect(narrowed.length).toBeLessThan(20);
    expect(narrowed.map((passage) => passage.marker)).toContain('P18');
    const broad = passagesForSection(many, ['Summary'], { broad: true, budget: 400 });
    expect(broad.length).toBeLessThan(20);
    expect(broad.length).toBeGreaterThan(0);
  });

  it('copies the quote from the passage without changing a character', () => {
    const passage = 'First line.\nCosts  rose to $5.2 billion by 2012, according to the audit. A later sentence.';
    const quote = bestQuote(passage, 'The audit found costs reached $5.2 billion by 2012');
    expect(passage).toContain(quote);
    expect(quote).toContain('Costs  rose to $5.2 billion by 2012');
  });

  it('removes a marker that names no passage and lists no reference for it', () => {
    const finalized = finalizeLockedCitations('## Summary\nA fact [P1]. A stray one [P7].', passages(), '2 Oct 2026');
    expect(finalized.markdown).toContain('A fact [1]. A stray one.');
    expect(finalized.removed).toBe(1);
    expect(finalized.occurrences).toHaveLength(1);
  });

  it('says no sources were used when nothing is cited', () => {
    const finalized = finalizeLockedCitations('## Summary\nNothing cited here.', passages(), '2 Oct 2026');
    expect(finalized.markdown).not.toContain('## References');
    expect(finalized.markdown.trimEnd().endsWith('No sources were used.')).toBe(true);
  });

  it('replaces a reference list or closing note already in the text', () => {
    const finalized = finalizeLockedCitations('## Summary\nA fact [P3].\n\n## References\n1. Stale\n\n## About this report\nStale.', passages(), '2 Oct 2026');
    expect(finalized.markdown.match(/## References/g)).toHaveLength(1);
    expect(finalized.markdown).not.toContain('Stale');
  });

  it('removes a bare number the lock did not issue, so it cannot pass as a citation', () => {
    const finalized = finalizeLockedCitations('## Summary\nA fact [P3]. A leftover [1]. Another [P1].', passages(), '2 Oct 2026');
    expect(finalized.markdown).toContain('A fact [1]. A leftover. Another [2].');
    expect(finalized.occurrences.map((occurrence) => occurrence.number)).toEqual([1, 2]);
    expect(finalized.removed).toBe(1);
  });

  it('accepts a rewrite only when each citation stays on the statement it was written for', () => {
    const draft = 'Costs reached five billion dollars by 2012 [P1]. The tunnel opened to passengers in 2015 [P2].';
    const keep = { allowRemoval: false };
    // Unchanged wording, different spacing, punctuation and marker case.
    expect(markersPreserved(draft, 'Costs reached five billion dollars, by 2012 [p1].  The tunnel opened to passengers in 2015 [P2].', keep)).toBe(true);
    // Reworded: the rewrite did not see the passage, so the citation no longer stands.
    expect(markersPreserved(draft, 'By 2012 costs had reached five billion dollars [P1]. The tunnel opened to passengers in 2015 [P2].', keep)).toBe(false);
    // One added word reverses the claim.
    expect(markersPreserved('The vaccine is safe for adults [P1].', 'The vaccine is not safe for adults [P1].', keep)).toBe(false);
    // Same markers, swapped between the two statements.
    expect(markersPreserved(draft, 'Costs reached five billion dollars by 2012 [P2]. The tunnel opened to passengers in 2015 [P1].', keep)).toBe(false);
    // Marker kept, statement replaced.
    expect(markersPreserved(draft, 'The project was cancelled outright [P1]. The tunnel opened to passengers in 2015 [P2].', keep)).toBe(false);
    // A citation added.
    expect(markersPreserved(draft, `${draft} Ridership doubled within a year [P1].`, { allowRemoval: true })).toBe(false);
    // A citation dropped with its sentence.
    expect(markersPreserved(draft, 'Costs reached five billion dollars by 2012 [P1].', keep)).toBe(false);
    expect(markersPreserved(draft, 'Costs reached five billion dollars by 2012 [P1].', { allowRemoval: true })).toBe(true);
    const kept = keepRewritesThatPreserveMarkers(
      [{ content: draft }, { content: 'The audit was published in 2016 [P3].' }],
      [{ content: 'Costs reached five billion dollars by 2012 [P2].' }, { content: 'In 2016 the audit was published [P3].' }],
      { allowRemoval: true }
    );
    // The first rewrite moved a citation; the second reworded a cited sentence. Both fall back to the original.
    expect(kept.map((section) => section.content)).toEqual([draft, 'The audit was published in 2016 [P3].']);
  });

  it('after a repair, keeps the repaired text and removes citations the repair added or moved', () => {
    const before = '## Summary\nCosts reached five billion dollars by 2012 [P1].\n\n## Detail\nThe tunnel opened to passengers in 2015 [P2].';
    const after = '## Summary\nCosts reached five billion dollars by 2012 [P1].\n\n## Detail\nThe tunnel opened to passengers in 2015 [P2]. Ridership doubled within a year [P2].\n\n## Added section\nA new statement the repair wrote [P1].';
    const checked = stripUnsupportedMarkers(before, after);
    expect(checked.removed).toBe(2);
    expect(checked.markdown).toContain('Costs reached five billion dollars by 2012 [P1].');
    expect(checked.markdown).toContain('The tunnel opened to passengers in 2015 [P2]. Ridership doubled within a year.');
    expect(checked.markdown).toContain('A new statement the repair wrote.');
    expect(checked.markdown).toContain('## Added section');
  });

  it('leaves bracketed numbers in code alone', () => {
    const text = '## Steps\nRead the first item with `items[0]` and cite it [P1].\n\n```python\nvalue = rows[1]\n```\nA stray prose number [2].';
    const finalized = finalizeLockedCitations(text, passages(), '2 Oct 2026');
    expect(finalized.markdown).toContain('`items[0]`');
    expect(finalized.markdown).toContain('value = rows[1]');
    expect(finalized.markdown).toContain('and cite it [1].');
    expect(finalized.markdown).toContain('A stray prose number.');
    expect(finalized.removed).toBe(1);
  });

  it('takes citation numbers out of a version that has no saved citations behind it', () => {
    expect(stripReaderNumbers('Costs rose [1]. Use `rows[1]` here [2][3].')).toBe('Costs rose. Use `rows[1]` here.');
  });

  it('keeps the fixed source count from deciding a Layer 1 run', () => {
    expect(countShortfallSetsStatus(true)).toBe(false);
    expect(countShortfallSetsStatus(false)).toBe(true);
  });
});

describe('markers in either case and numbers that are not citations', () => {
  it('treats a lower-case marker as the same citation', () => {
    const shown = issuePassages(
      [{ id: 'chunk-a', content: 'The bridge opened in 1932.' }],
      [{ title: 'Bridge history', url: 'https://example.org/bridge' }]
    );
    expect(markersIn('It opened in 1932 [p1].')).toEqual(['P1']);
    expect(unknownMarkers('It opened in 1932 [p1]. It closed in 1990 [p7].', shown)).toEqual(['P7']);
    const finalized = finalizeLockedCitations('## Summary\nIt opened in 1932 [p1].', shown, '2 Oct 2026');
    expect(finalized.markdown).toContain('It opened in 1932 [1].');
    expect(finalized.occurrences).toHaveLength(1);
    expect(readerFacingLabelHits('It opened in 1932 [p1].')).toContain('passage marker');
  });

  it('reads grouped markers in the forms a model writes, and removes what it cannot read', () => {
    expect(markersIn('A [P1/P2]. B [P1 and P3]. C [P2, 4]. D [P1\u2013P3]. E [p5-p6].')).toEqual([
      'P1', 'P2', 'P1', 'P3', 'P2', 'P4', 'P1', 'P2', 'P3', 'P5', 'P6',
    ]);
    const shown = issuePassages(
      [{ id: 'chunk-a', content: 'The bridge opened in 1932.' }, { id: 'chunk-b', content: 'It cost four million.' }],
      [{ title: 'Bridge history', url: 'https://example.org/a' }, { title: 'Bridge costs', url: 'https://example.org/b' }]
    );
    expect(unknownMarkers('It opened [P1\u2013P3].', shown)).toEqual(['P3']);
    const finalized = finalizeLockedCitations('## Summary\nIt opened and was paid for [P1/P2]. It still stands [P1 see also the archive].', shown, '2 Oct 2026');
    expect(finalized.markdown).toContain('paid for [1][2]. It still stands.');
    expect(finalized.markdown).not.toMatch(/\[P\d/i);
    expect(finalized.removed).toBe(1);
    expect(readerFacingLabelHits('It opened [P1\u2013P3].')).toContain('passage marker');
  });

  it('does not count a number in code or a link label as a citation', () => {
    const occurrences = [
      { number: 1, chunkId: 'chunk-a', quote: 'A.' },
      { number: 2, chunkId: 'chunk-b', quote: 'B.' },
    ];
    const bound = assignOccurrencesToSections(
      [
        { title: 'Background', content: 'See `items[2]` and the note [1](https://example.org). The first fact [1].' },
        { title: 'Findings', content: 'The second fact [2].' },
      ],
      occurrences
    );
    expect(bound.map((row) => [row.number, row.sectionOrder])).toEqual([[1, 1], [2, 2]]);
  });
});

describe('code, links and stale reference lists', () => {
  const shown = (): LockedPassage[] =>
    issuePassages(
      [{ id: 'chunk-a', content: 'The bridge opened in 1932.' }],
      [{ title: 'Bridge history', url: 'https://example.org/bridge' }]
    );

  it('leaves every form of code and link untouched', () => {
    const body = [
      '## Summary',
      'It opened in 1932 [P1].',
      '',
      '~~~~',
      'rows[1] = cells[P1]',
      '~~~~',
      '',
      '````js',
      'a[2]',
      '````',
      '',
      '    indented[3]',
      '',
      'See [the note][1] for more.',
      '',
      '[1]: https://example.org/note',
    ].join('\n');
    const finalized = finalizeLockedCitations(body, shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('It opened in 1932 [1].');
    expect(finalized.markdown).toContain('rows[1] = cells[P1]');
    expect(finalized.markdown).toContain('a[2]');
    expect(finalized.markdown).toContain('    indented[3]');
    expect(finalized.markdown).toContain('[the note][1]');
    expect(finalized.markdown).toContain('[1]: https://example.org/note');
    expect(finalized.occurrences).toHaveLength(1);
    expect(finalized.removed).toBe(0);
  });

  it('numbers markers written side by side and in nested list text', () => {
    const two = issuePassages(
      [{ id: 'chunk-a', content: 'The bridge opened in 1932.' }, { id: 'chunk-b', content: 'It cost four million.' }],
      [{ title: 'Bridge history', url: 'https://example.org/a' }, { title: 'Bridge costs', url: 'https://example.org/b' }]
    );
    const finalized = finalizeLockedCitations('## Summary\nIt opened and was paid for [P1][P2].\n\n- Point\n    - Nested point [P2].', two, '2 Oct 2026');
    expect(finalized.markdown).toContain('paid for [1][2].');
    // The nested item keeps its indentation and is still read as a citation.
    expect(finalized.markdown).toContain('\n    - Nested point [2].');
    expect(finalized.occurrences.map((occurrence) => occurrence.number)).toEqual([1, 2, 2]);
    const bound = assignOccurrencesToSections([{ title: 'Summary', content: finalized.markdown }], finalized.occurrences);
    expect(bound.every((row) => row.sectionOrder === 1)).toBe(true);
  });

  it('binds the text that is saved: the save-time clean-up changes nothing after finalizing', () => {
    const cleaned = stripInternalLabelsFromReport('## Summary\nIt opened in 1932 (speculation) [P1].');
    const finalized = finalizeLockedCitations(cleaned, shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('It opened in 1932 [1].');
    expect(stripInternalLabelsFromReport(finalized.markdown)).toBe(finalized.markdown);
  });

  it('keeps indented code that holds a marker, and binds a marker written as link text', () => {
    const body = '## Summary\nIt opened in 1932 [P1](https://example.org/x).\n\n    result = [P1]\n\nA repair wrote this [Chunk 4].';
    const finalized = finalizeLockedCitations(body, shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('It opened in 1932 [1].');
    expect(finalized.markdown).toContain('    result = [P1]');
    expect(finalized.markdown).toContain('A repair wrote this.');
    expect(finalized.occurrences).toHaveLength(1);
    const bound = assignOccurrencesToSections([{ title: 'Summary', content: finalized.markdown }], finalized.occurrences);
    expect(bound[0].sectionOrder).toBe(1);
    // Code that contains a marker is not a leak; the same marker in prose is.
    expect(readerFacingLabelHits('Example:\n\n    result = [P1]\n\n```\nCHUNK 1\n```')).toEqual([]);
    expect(readerFacingLabelHits('It opened [P1].')).toContain('passage marker');
  });

  it('leaves a code sample that contains a References heading alone', () => {
    const body = '## Summary\nIt opened in 1932 [P1].\n\n```md\n## References\nexample\n```\n\nStill here.';
    const finalized = finalizeLockedCitations(body, shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('```md\n## References\nexample\n```');
    expect(finalized.markdown).toContain('Still here.');
  });

  it('removes a bare chunk marker a repair wrote', () => {
    const finalized = finalizeLockedCitations('## Summary\nIt opened in 1932 [P1]. The cost is given in CHUNK 4.', shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('The cost is given.');
    expect(readerFacingLabelHits(finalized.markdown)).not.toContain('chunk marker');
  });

  it('numbers two stored sources apart even when they share a title and have no link', () => {
    const same = { title: 'Notes' };
    const passages = issuePassages(
      [{ id: 'chunk-a', content: 'The bridge opened in 1932.' }, { id: 'chunk-b', content: 'It cost four million.' }],
      [same, same],
      new Map([['chunk-a', 'source-1'], ['chunk-b', 'source-2']])
    );
    const finalized = finalizeLockedCitations('## Summary\nIt opened in 1932 [P1]. It cost four million [P2].', passages, '2 Oct 2026');
    expect(finalized.occurrences.map((occurrence) => occurrence.number)).toEqual([1, 2]);
    expect(finalized.cited).toHaveLength(2);
  });

  it('does not read marker-shaped code as a citation, and never edits it', () => {
    const draft = 'It opened in 1932 [P1]. A stray one [P9].\n\n```\nrows[P9] = 1\n```\n\nInline `cells[P9]` too.';
    expect(markersIn(draft)).toEqual(['P1', 'P9']);
    expect(unknownMarkers('Only code here: `rows[P9]`.', shown())).toEqual([]);
    const stripped = stripUnknownMarkers(draft, shown());
    expect(stripped).toContain('A stray one.');
    expect(stripped).toContain('rows[P9] = 1');
    expect(stripped).toContain('`cells[P9]`');
    const repaired = stripUnsupportedMarkers('It opened in 1932 [P1].', 'It opened in 1932 [P1]. New claim [P1].\n\n```\nrows[P1]\n```');
    expect(repaired.markdown).toContain('New claim.');
    expect(repaired.markdown).toContain('rows[P1]');
    expect(repaired.removed).toBe(1);
  });

  it('treats a link inside a cited sentence as part of the sentence', () => {
    const draft = 'The [FDA](https://fda.gov) authorized it in 2023 [P1].';
    const keep = { allowRemoval: false };
    expect(markersPreserved(draft, draft, keep)).toBe(true);
    // The label is what a reader sees; changing it changes the claim.
    expect(markersPreserved(draft, 'The [EMA](https://fda.gov) authorized it in 2023 [P1].', keep)).toBe(false);
    // An unchanged linked sentence keeps its citation through a repair.
    const repaired = stripUnsupportedMarkers(draft, `${draft} A new claim [P1].`);
    expect(repaired.markdown).toBe('The [FDA](https://fda.gov) authorized it in 2023 [P1]. A new claim.');
    expect(repaired.removed).toBe(1);
  });

  it('picks the quote that agrees with the claim on negation', () => {
    const passage = 'The treatment is safe for adults. The treatment is not safe for children.';
    expect(bestQuote(passage, 'It is not safe for children')).toBe('The treatment is not safe for children.');
    expect(bestQuote('The treatment is safe. The treatment is not safe.', 'The treatment is not safe')).toBe('The treatment is not safe.');
    expect(bestQuote('The treatment is not safe. The treatment is safe.', 'The treatment is safe')).toBe('The treatment is safe.');
  });

  it('counts sources read by the same identity the numbers use', () => {
    const same = { title: 'Notes' };
    const passages = issuePassages(
      [{ id: 'chunk-a', content: 'The bridge opened in 1932.' }, { id: 'chunk-b', content: 'It cost four million.' }],
      [same, same],
      new Map([['chunk-a', 'source-1'], ['chunk-b', 'source-2']])
    );
    const finalized = finalizeLockedCitations('## Summary\nIt opened in 1932 [P1].', passages, '2 Oct 2026');
    expect(finalized.markdown).toMatch(/2 sources/);
  });

  it('uses the whole sentence, link label included, to choose the quote', () => {
    const passages = issuePassages(
      [{ id: 'chunk-a', content: 'The EMA authorized it in 2023. The FDA authorized it in 2023.' }],
      [{ title: 'Regulators', url: 'https://example.org/r' }]
    );
    const finalized = finalizeLockedCitations('## Summary\nThe [FDA](https://fda.gov) authorized it in 2023 [P1].', passages, '2 Oct 2026');
    expect(finalized.occurrences[0].quote).toBe('The FDA authorized it in 2023.');
  });

  it('carries citations into a revision only where the cited sentence is unchanged', () => {
    const base = [
      { key: 'a', content: 'It opened in 1932 [1]. It cost four million [2].' },
      { key: 'b', content: 'It closed in 1990 [1].' },
    ];
    const rows = [
      { sectionKey: 'a', citationText: '[1]', row: 'row-a1' },
      { sectionKey: 'a', citationText: '[2]', row: 'row-a2' },
      { sectionKey: 'b', citationText: '[1]', row: 'row-b1' },
    ];
    const revised = [
      { key: 'new', content: 'A section the revision added [1].' },
      { key: 'a', content: 'It cost four million [2]. It opened in 1933 [1].' },
      { key: 'b', content: 'It closed in 1990 [1].' },
    ];
    const rebound = rebindRevisedCitations(base, rows, revised);
    expect(rebound.contents).toEqual(['A section the revision added.', 'It cost four million [2]. It opened in 1933.', 'It closed in 1990 [1].']);
    // Reading order of the revised report, each row on its own section.
    expect(rebound.kept).toEqual([
      { sectionIndex: 1, row: 'row-a2' },
      { sectionIndex: 2, row: 'row-b1' },
    ]);
    expect(rebound.removed).toBe(2);
  });

  it('binds a marker that a link definition turned into a reference link', () => {
    const finalized = finalizeLockedCitations('## Summary\nIt opened in 1932 [P1].\n\n[P1]: https://example.org/x', shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('It opened in 1932 [1].');
    expect(finalized.occurrences).toHaveLength(1);
  });

  it('numbers sources again after a revision drops one, and trims the reference list', () => {
    const out = renumberAfterRevision(
      [
        { title: 'Summary', content: 'It cost four million [2]. See `rows[2]`.' },
        { title: 'Findings', content: 'It closed in 1990 [3]. It cost a lot [2].' },
        { title: 'References', content: '1. First source\n2. Second source\n3. Third source' },
        { title: 'About this report', content: '3 sources were read on 2 Oct 2026.' },
      ],
      ['[2]', '[3]', '[2]']
    );
    expect(out.contents).toEqual([
      'It cost four million [1]. See `rows[2]`.',
      'It closed in 1990 [2]. It cost a lot [1].',
      '1. Second source\n2. Third source',
      '3 sources were read on 2 Oct 2026.',
    ]);
    expect(out.citationTexts).toEqual(['[1]', '[2]', '[1]']);
  });

  it('removes a number a revision adds to a locked report that cited nothing', () => {
    const rebound = rebindRevisedCitations([{ key: 'a', content: 'Nothing was cited.' }], [], [{ key: 'a', content: 'Now it claims a source [1].' }]);
    expect(rebound.contents).toEqual(['Now it claims a source.']);
    expect(rebound.kept).toEqual([]);
  });

  it('treats a repeated sentence as repeated whatever form its markers take', () => {
    const plain = sentenceKey('It opened in 1932 [P1, P2].');
    expect(sentenceKey('It opened in 1932 [P1/P2].')).toBe(plain);
    expect(sentenceKey('It opened in 1932 [P1 and P2].')).toBe(plain);
    expect(sentenceKey('It opened in 1932 [P1\u2013P3].')).toBe(plain);
  });

  it('removes an export-style alias the writer emitted', () => {
    const finalized = finalizeLockedCitations('## Summary\nIt opened in 1932 [P1]. It cost a lot [E1].\n\n`rows[E1]`', shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('It opened in 1932 [1]. It cost a lot.');
    expect(finalized.markdown).toContain('`rows[E1]`');
    expect(finalized.removed).toBe(1);
  });

  it('binds a marker written as the text of a full reference link', () => {
    const finalized = finalizeLockedCitations('## Summary\nIt opened in 1932 [P1][source].\n\n[source]: https://example.org/x', shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('It opened in 1932 [1].');
    expect(finalized.occurrences).toHaveLength(1);
  });

  it('keeps a report whose own title is References', () => {
    const finalized = finalizeLockedCitations('# References\n\n## Summary\nIt opened in 1932 [P1].', shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('# References\n\n## Summary\nIt opened in 1932 [1].');
  });

  it('carries and renumbers a citation that sits in a heading', () => {
    const rebound = rebindRevisedCitations(
      [{ key: 'a', content: 'The 1932 opening [2]\n\nIt cost four million [1].' }],
      [
        { sectionKey: 'a', citationText: '[2]', row: 'row-title' },
        { sectionKey: 'a', citationText: '[1]', row: 'row-body' },
      ],
      [{ key: 'a', content: 'The 1932 opening [2]\n\nIt cost five million [1].' }]
    );
    expect(rebound.contents).toEqual(['The 1932 opening [2]\n\nIt cost five million.']);
    expect(rebound.kept).toEqual([{ sectionIndex: 0, row: 'row-title' }]);
    const out = renumberAfterRevision([{ title: 'The 1932 opening [2]', content: 'It cost five million.' }], ['[2]']);
    expect(out.titles).toEqual(['The 1932 opening [1]']);
    expect(out.citationTexts).toEqual(['[1]']);
  });

  it('keeps source titles from putting markers or headings into the report', () => {
    const passages = issuePassages(
      [{ id: 'chunk-a', content: 'The bridge opened in 1932.' }],
      [{ title: 'Study [P9]\n## About this report', publisher: 'Press [1]', url: 'https://example.org/x' }]
    );
    const finalized = finalizeLockedCitations('## Summary\nIt opened in 1932 [P1].', passages, '2 Oct 2026');
    expect(finalized.markdown).toContain('Press (1), Study (P9) ## About this report');
    expect(finalized.markdown.match(/^## About this report$/gm)).toHaveLength(1);
    expect(readerFacingLabelHits(finalized.markdown)).not.toContain('passage marker');
  });

  it('reads a number as a citation even when a link definition shares it', () => {
    expect(readerNumbersIn('A fact [1].\n\n[1]: https://example.org')).toEqual(['[1]']);
    const finalized = finalizeLockedCitations('## Summary\nIt opened in 1932 [P1]. A stray one [1].\n\n[1]: https://example.org', shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('It opened in 1932 [1]. A stray one.');
    expect(finalized.occurrences).toHaveLength(1);
  });

  it('does not cut a cited sentence at a line wrap or an abbreviation', () => {
    const keep = { allowRemoval: false };
    const wrapped = 'Costs increased substantially\nand reached five billion [P1].';
    expect(markersPreserved(wrapped, 'Costs increased substantially and reached five billion [P1].', keep)).toBe(true);
    expect(markersPreserved(wrapped, 'Costs decreased substantially\nand reached five billion [P1].', keep)).toBe(false);
    const abbreviated = 'The U.S. FDA authorized it in 2023 [P1].';
    expect(markersPreserved(abbreviated, 'The E.U. FDA authorized it in 2023 [P1].', keep)).toBe(false);
    expect(markersPreserved(abbreviated, abbreviated, keep)).toBe(true);
  });

  it('keeps code inside a nested list item while binding the citation beside it', () => {
    const finalized = finalizeLockedCitations('## Summary\n- Point\n    - Compare `rows[P2]` with the fact [P1].', shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('    - Compare `rows[P2]` with the fact [1].');
    expect(finalized.occurrences).toHaveLength(1);
  });

  it('removes grouped numbers from text that carries no saved citations', () => {
    expect(stripReaderNumbers('A fact [1, 2]. Another [1 and 2]. A range [1-3]. Code `rows[1, 2]`.')).toBe(
      'A fact. Another. A range. Code `rows[1, 2]`.'
    );
  });

  it('does not treat a grade word inside code as a label', () => {
    expect(readerFacingLabelHits('Example:\n\n```\nlabel = (inference)\n```')).toEqual([]);
    expect(readerFacingLabelHits('The claim holds (inference).')).toContain('grade label');
  });

  it('removes numbers a revision merged into one bracket', () => {
    const rebound = rebindRevisedCitations(
      [{ key: 'a', content: 'It opened in 1932 [1][2]. It closed in 1990 [3].' }],
      [
        { sectionKey: 'a', citationText: '[1]', row: 'r1' },
        { sectionKey: 'a', citationText: '[2]', row: 'r2' },
        { sectionKey: 'a', citationText: '[3]', row: 'r3' },
      ],
      [{ key: 'a', content: 'It opened in 1932 [1, 2]. It closed in 1990 [3].' }]
    );
    expect(rebound.contents).toEqual(['It opened in 1932. It closed in 1990 [3].']);
    expect(rebound.kept).toEqual([{ sectionIndex: 0, row: 'r3' }]);
  });

  it('does not join text across a code span into a false marker', () => {
    expect(readerFacingLabelHits('CH`x`UNK 1 is not a marker.')).toEqual([]);
  });

  it('does not let a rewrite drop a citation while keeping its sentence', () => {
    const draft = 'Costs reached five billion dollars by 2012 [P1]. The tunnel opened in 2015 [P2].';
    const removal = { allowRemoval: true };
    expect(markersPreserved(draft, 'Costs reached five billion dollars by 2012. The tunnel opened in 2015 [P2].', removal)).toBe(false);
    expect(markersPreserved(draft, 'The tunnel opened in 2015 [P2].', removal)).toBe(true);
  });

  it('tells the writer plainly when nothing was retrieved', () => {
    expect(formatLockedContext([])).toContain('No passages are available');
    expect(issuePassages([], [])).toEqual([]);
  });

  it('leaves indented code alone even when it ends like a sentence', () => {
    const body = '## Summary\nIt opened in 1932 [P1].\n\n    return [P1];\n\n    return [1].';
    const finalized = finalizeLockedCitations(body, shown(), '2 Oct 2026');
    expect(finalized.markdown).toContain('    return [P1];');
    expect(finalized.markdown).toContain('    return [1].');
    expect(finalized.occurrences).toHaveLength(1);
  });

  it('does not carry a citation whose passage is gone', () => {
    const rebound = rebindRevisedCitations(
      [{ key: 'a', content: 'It opened in 1932 [1]. It closed in 1990 [2].' }],
      [
        { sectionKey: 'a', citationText: '[1]', row: { chunk: null as string | null } },
        { sectionKey: 'a', citationText: '[2]', row: { chunk: 'c2' as string | null } },
      ],
      [{ key: 'a', content: 'It opened in 1932 [1]. It closed in 1990 [2].' }],
      (row) => row.chunk != null
    );
    expect(rebound.contents).toEqual(['It opened in 1932. It closed in 1990 [2].']);
    expect(rebound.kept).toEqual([{ sectionIndex: 0, row: { chunk: 'c2' } }]);
  });

  it('says no sources were used when a revision leaves nothing cited', () => {
    const out = renumberAfterRevision(
      [
        { title: 'Summary', content: 'Nothing is cited now.' },
        { title: 'About this report', content: '3 sources were read on 2 Oct 2026.' },
      ],
      []
    );
    expect(out.contents[1]).toBe('No sources were used.');
  });

  it('removes a model-written reference list together with its sub-headings', () => {
    const body = '## Summary\nIt opened in 1932 [P1].\n\n## References\n### Primary sources\nA stale entry.\n### Other\nAnother stale entry.\n\n## Notes\nKept.';
    const finalized = finalizeLockedCitations(body, shown(), '2 Oct 2026');
    expect(finalized.markdown).not.toContain('stale entry');
    expect(finalized.markdown).not.toContain('Primary sources');
    expect(finalized.markdown).toContain('## Notes\nKept.');
    expect(finalized.markdown.match(/## References/g)).toHaveLength(1);
  });
});

describe('labels a reader must not see', () => {
  it.each([
    ['Costs rose [Chunk 12].', 'chunk marker'],
    ['Costs rose [Chunks 2, 13].', 'chunk marker'],
    ['See CHUNK 4 for detail.', 'chunk marker'],
    ['Costs rose [P3].', 'passage marker'],
    ['Costs rose (Testimony).', 'grade label'],
    ['Costs rose (Strong_Evidence).', 'grade label'],
    ['Costs rose [inference].', 'grade label'],
  ])('flags %s', (text, hit) => {
    expect(readerFacingLabelHits(text)).toContain(hit);
  });

  it('passes ordinary prose and numbered citations', () => {
    expect(readerFacingLabelHits('Congressional testimony said the vote was public [1]. Statistical inference was not required [2].')).toEqual([]);
  });
});
