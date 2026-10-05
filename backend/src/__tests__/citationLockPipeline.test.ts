import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ role: string; text: string }> = [];
let firstDraftCitesUnknown = false;
let retryAlsoCitesUnknown = false;
let limitsRepeatsSummary = false;
let rewriteSwapsMarkers = false;
let summaryHasVerdict = false;

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

import { generateIterativeReport, isSubjectSection, removeBannedWording } from '../services/reasoning/reportGenerator';
import { INTENT_OUTPUT_TEMPLATES } from '../services/formatting/templates/intentOutputTemplates';
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
  guardLockedRepair,
  LOCKED_REPAIR_RULE,
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
    summaryHasVerdict = false;
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
    // Two passages from one source share its number, and side by side it is shown once.
    expect(finalized.markdown).toContain('aged 12 and older [1].');
    expect(finalized.markdown).not.toMatch(/\[1\]\s*\[1\]/);
    const references = finalized.markdown.split('## References\n')[1].split('\n\n## About this report')[0].split('\n');
    expect(references).toEqual([
      '1. US Food and Drug Administration. FDA approves first gene therapies to treat sickle cell disease. 8 Dec 2023. https://www.fda.gov/casgevy',
      '2. Medicines and Healthcare products Regulatory Agency. MHRA authorises gene therapy. 16 Nov 2023. https://www.gov.uk/mhra-casgevy',
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

  it('takes banned wording out of a section the redraft could not keep', async () => {
    summaryHasVerdict = true;
    const report = await writeLocked();
    expect(calls.some((call) => call.text.includes('Rewrite the report in plain encyclopedia prose'))).toBe(true);
    // The redraft moved the citation, so its version of the section was refused; the wording is fixed without it.
    expect(report.markdown).not.toMatch(/verdict/i);
    expect(report.markdown).toContain('The finding of the agency was to authorize Casgevy');
    expect(report.markdown).toContain('8 December 2023 [P1].');
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

  describe('a repair held to the citation lock', () => {
    const before = [
      '# First CRISPR therapy approval',
      '',
      '## Summary',
      'The FDA approved Casgevy on 8 December 2023 [P1]. It treats sickle cell disease in patients aged 12 and older [P1, P2].',
      '',
      '## Key findings',
      '- The approval came on 8 December 2023 [P1].',
      '- Eligible patients have recurrent crises [P2].',
      '',
      '## Limits of this report',
      'The sources do not cover long-term follow-up.',
    ].join('\n');

    it('puts back every section a repair returned with its citations gone', () => {
      // What a live run did: a correct, cited report came back as bare sentences and was saved with no references.
      const after = '# First CRISPR therapy approval\n\n## Summary\nThe FDA approved Casgevy on 8 December 2023.\n\n## Key findings\n- The approval came on 8 December 2023.\n\n## Limits of this report\nThis report covers the approval only.';
      const guarded = guardLockedRepair(before, after);
      // Every section comes back as it was: two lost their citations and the third was reworded from no source.
      expect(guarded.restored).toEqual(['Summary', 'Key findings', 'Limits of this report']);
      expect(guarded.markdown).toBe(before);
      expect(guarded.markdown).toContain('The FDA approved Casgevy on 8 December 2023 [P1]. It treats sickle cell disease in patients aged 12 and older [P1, P2].');
      expect(guarded.markdown).toContain('- Eligible patients have recurrent crises [P2].');
      const finalized = finalizeLockedCitations(guarded.markdown, passages(), '5 Oct 2026');
      expect(finalized.markdown).toContain('## References');
      expect(finalized.occurrences.length).toBeGreaterThan(0);
    });

    it('accepts a repair that cut sentences and kept the citations of those it kept', () => {
      const after = before.replace(' It treats sickle cell disease in patients aged 12 and older [P1, P2].', '');
      const guarded = guardLockedRepair(before, after);
      expect(guarded.restored).toEqual([]);
      expect(guarded.markdown).toContain('## Summary\nThe FDA approved Casgevy on 8 December 2023 [P1].\n');
      expect(guarded.markdown).not.toContain('patients aged 12 and older');
    });

    it('puts a section back when one kept sentence lost its citation and another kept its own', () => {
      const after = before.replace('- The approval came on 8 December 2023 [P1].', '- The approval came on 8 December 2023.');
      const guarded = guardLockedRepair(before, after);
      expect(guarded.restored).toEqual(['Key findings']);
      expect(guarded.markdown).toContain('- The approval came on 8 December 2023 [P1].');
    });

    it('puts a section back when a citation was moved to another statement', () => {
      const after = before.replace('- The approval came on 8 December 2023 [P1].\n- Eligible patients have recurrent crises [P2].', '- The approval came on 8 December 2023 [P2].\n- Eligible patients have recurrent crises [P1].');
      expect(guardLockedRepair(before, after).restored).toEqual(['Key findings']);
    });

    it('keeps a section the repair left out, in the report\'s own order', () => {
      const after = '# First CRISPR therapy approval\n\n## Limits of this report\nThe sources do not cover long-term follow-up.\n\n## Summary\nThe FDA approved Casgevy on 8 December 2023 [P1].';
      const guarded = guardLockedRepair(before, after);
      expect(guarded.restored).toEqual(['Key findings']);
      expect([...guarded.markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual(['Summary', 'Key findings', 'Limits of this report']);
      expect(guarded.markdown).toContain('- Eligible patients have recurrent crises [P2].');
      expect(guarded.markdown).toContain('## Summary\nThe FDA approved Casgevy on 8 December 2023 [P1].\n');
    });

    it('puts a section back when the repair added a sentence with no citation', () => {
      const after = before.replace('[P1, P2].', '[P1, P2]. The therapy costs about two million dollars per patient.');
      const guarded = guardLockedRepair(before, after);
      expect(guarded.restored).toEqual(['Summary']);
      expect(guarded.markdown).not.toContain('two million dollars');
      // The same number of sentences, one of them swapped for an unsupported one, is still new material.
      const swapped = guardLockedRepair(before, before.replace('The sources do not cover long-term follow-up.', 'The therapy costs about two million dollars per patient.'));
      expect(swapped.restored).toEqual(['Limits of this report']);
      // So is a clause added to a sentence the report had.
      const extended = guardLockedRepair(before, before.replace('long-term follow-up.', 'long-term follow-up, which costs two million dollars.'));
      expect(extended.restored).toEqual(['Limits of this report']);
    });

    it('keeps the report\'s own title and adds no preamble, sub-heading or link of any kind', () => {
      const preamble = guardLockedRepair(before, before.replace('# First CRISPR therapy approval', '# A new title\n\nCasgevy is the most important therapy of the decade.'));
      expect(preamble.markdown.startsWith('# First CRISPR therapy approval\n\n## Summary')).toBe(true);
      expect(preamble.markdown).not.toContain('most important therapy');
      const nested = guardLockedRepair(before, before.replace('## Limits of this report\n', '## Limits of this report\n### Pricing\n'));
      expect(nested.restored).toEqual(['Limits of this report']);
      const paths = guardLockedRepair(before, before.replace('The FDA approved Casgevy', '[The FDA approved Casgevy](/invented-source)').replace('long-term follow-up', '[long-term follow-up](mailto:someone@example.org)'));
      expect(paths.restored).toEqual(['Summary', 'Limits of this report']);
      expect(paths.markdown).not.toMatch(/invented-source|mailto:/);
      // Reference links, their definitions, autolinks and underlined headings are links and headings too.
      const reference = guardLockedRepair(before, before.replace('The FDA approved Casgevy', '[The FDA approved Casgevy][new]').replace('long-term follow-up.', 'long-term follow-up.\n\n[new]: /invented-source'));
      expect(reference.restored).toEqual(['Summary', 'Limits of this report']);
      expect(guardLockedRepair(before, before.replace('long-term follow-up.', 'long-term follow-up <https://example.org/x>.')).restored).toEqual(['Limits of this report']);
      // A top-level heading inside a section, a shortcut reference, a bare host and a mail address.
      expect(guardLockedRepair(before, before.replace('The sources do not cover', '# Invented section\nThe sources do not cover')).restored).toEqual(['Limits of this report']);
      expect(guardLockedRepair(before, before.replace('long-term follow-up.', 'long-term follow-up, says [agency].')).restored).toEqual(['Limits of this report']);
      expect(guardLockedRepair(before, before.replace('long-term follow-up.', 'long-term follow-up; see www.example.org for more.')).restored).toEqual(['Limits of this report']);
      expect(guardLockedRepair(before, before.replace('long-term follow-up.', 'long-term follow-up; write to press@example.org for more.')).restored).toEqual(['Limits of this report']);
      const setext = guardLockedRepair(before, before.replace('The sources do not cover long-term follow-up.', 'Added section\n---\nInvented statement.'));
      expect(setext.restored).toEqual(['Limits of this report']);
    });

    it('keeps a link the section already had, and puts the section back when the link moves to another statement', () => {
      const linkedBefore = before.replace('The sources do not cover long-term follow-up.', 'The sources do not cover long-term follow-up. See [the agency](https://www.fda.gov/casgevy) for updates.');
      // The linked sentence stays as it was while another sentence is cut.
      const cut = guardLockedRepair(linkedBefore, linkedBefore.replace('The sources do not cover long-term follow-up. ', ''));
      // A section that holds a link is taken unchanged or not at all, so even a clean cut beside the link puts it back.
      expect(cut.restored).toEqual(['Limits of this report']);
      expect(guardLockedRepair(linkedBefore, linkedBefore).restored).toEqual([]);
      // The same link moved onto other words in the same section is not the link the report had.
      expect(guardLockedRepair(linkedBefore, linkedBefore.replace('See [the agency](https://www.fda.gov/casgevy) for updates.', 'Ask [the agency](https://www.fda.gov/casgevy) about pricing.')).restored).toEqual(['Limits of this report']);
      const moved = linkedBefore.replace('See [the agency](https://www.fda.gov/casgevy) for updates.', 'See the agency for updates.').replace('The sources do not cover', '[The sources](https://www.fda.gov/casgevy) do not cover');
      expect(guardLockedRepair(linkedBefore, moved).restored).toEqual(['Limits of this report']);
    });

    it('puts back a section that had no citations when the repair wrote one into it', () => {
      const after = before.replace('The sources do not cover long-term follow-up.', 'The therapy was priced at two million dollars [P1].');
      const guarded = guardLockedRepair(before, after);
      expect(guarded.restored).toEqual(['Limits of this report']);
      expect(guarded.markdown).not.toContain('two million dollars');
    });

    it('reads lower-case and grouped markers as citations', () => {
      const grouped = '## Summary\nThe FDA approved Casgevy on 8 December 2023 [p1]. It treats sickle cell disease [P1 and P2].';
      const guarded = guardLockedRepair(grouped, '## Summary\nThe FDA approved Casgevy on 8 December 2023. It treats sickle cell disease.');
      expect(guarded.restored).toEqual(['Summary']);
      expect(guarded.markdown).toContain('[p1]');
    });

    it('does not add a section the repair wrote from no passage, or a link the report did not have', () => {
      const after = `${before}\n\n## Report lacks a citation\nThe approval is confirmed by the agency. Source: [FDA press release](https://www.fda.gov/invented-page).`;
      const guarded = guardLockedRepair(before, after);
      expect(guarded.dropped).toEqual(['Report lacks a citation']);
      expect(guarded.markdown).not.toContain('Report lacks a citation');
      expect(guarded.markdown).not.toContain('fda.gov/invented-page');
      const linked = guardLockedRepair(before, before.replace('long-term follow-up.', 'long-term follow-up (see https://example.org/more and [the agency](https://www.fda.gov/x)).'));
      expect(linked.restored).toEqual(['Limits of this report']);
      expect(linked.markdown).toBe(`${before}\n`);
    });

    it('keeps the report as it was when the repair leaves nothing usable', () => {
      expect(guardLockedRepair(before, 'I have revised the report as requested.').markdown).toBe(before);
      expect(guardLockedRepair(before, '## A different heading\nSomething else entirely.').markdown).toBe(before);
    });

    it('puts back sections returned as headings with nothing under them', () => {
      const skeleton = '# First CRISPR therapy approval\n\n## Summary\n\n## Key findings\n\n## Limits of this report\n';
      expect(guardLockedRepair(before, skeleton).markdown).toBe(before);
    });

    it('puts back a section cut down to a sub-heading with nothing under it', () => {
      const nested = before.replace('The sources do not cover long-term follow-up.', '### Follow-up\nThe sources do not cover long-term follow-up [P2].');
      expect(guardLockedRepair(nested, nested.replace('\nThe sources do not cover long-term follow-up [P2].', '')).restored).toEqual(['Limits of this report']);
    });

    it('takes neither of two sections that share a name from the repair', () => {
      const twin = `${before}\n\n## Key findings\n- The approval came on 8 December 2023 [P1].\n- A second point stands here [P2].`;
      const guarded = guardLockedRepair(twin, twin.replace('\n\n## Key findings\n- The approval came on 8 December 2023 [P1].\n- A second point stands here [P2].', '').replace('- Eligible patients have recurrent crises [P2].\n', ''));
      expect(guarded.restored).toEqual(['Key findings', 'Key findings']);
      expect(guarded.markdown).toContain('- A second point stands here [P2].');
      expect(guarded.markdown).toContain('- Eligible patients have recurrent crises [P2].');
    });

    it('does not let a cut bring mid-line words to the start of a line as a heading', () => {
      const inline = before.replace('The sources do not cover long-term follow-up.', 'An opening sentence. # Caveat [P1]. The rest [P2].');
      expect(guardLockedRepair(inline, inline.replace('An opening sentence. ', '')).restored).toEqual(['Limits of this report']);
    });

    it('does not cut inside a link or code span that runs across sentences', () => {
      const spanning = before.replace('The sources do not cover long-term follow-up.', '[Background first. The agency page.](https://www.fda.gov/casgevy) The sources stop in 2023 [P2].');
      expect(guardLockedRepair(spanning, spanning).restored).toEqual([]);
      expect(guardLockedRepair(spanning, spanning.replace('[Background first. ', '')).restored).toEqual(['Limits of this report']);
    });

    it('puts back a cited section left with only its uncited sentence, and a nested list that lost a parent', () => {
      const mixed = before.replace('The FDA approved Casgevy on 8 December 2023 [P1].', 'This section sets out the decision. The FDA approved Casgevy on 8 December 2023 [P1].');
      const bare = mixed.replace(' The FDA approved Casgevy on 8 December 2023 [P1]. It treats sickle cell disease in patients aged 12 and older [P1, P2].', '');
      expect(guardLockedRepair(mixed, bare).restored).toEqual(['Summary']);
      const nested = before.replace('- The approval came on 8 December 2023 [P1].\n- Eligible patients have recurrent crises [P2].', '- Group A\n  - Claim A [P1].\n- Group B\n  - Claim B [P2].');
      expect(guardLockedRepair(nested, nested.replace('- Group B\n', '')).restored).toEqual(['Key findings']);
    });

    it('takes a section holding a bare address or a spaced hyphen unchanged or not at all', () => {
      const bare = before.replace('The sources do not cover long-term follow-up.', 'An opening sentence. See https://www.fda.gov/casgevy for updates.');
      expect(guardLockedRepair(bare, bare.replace('An opening sentence. ', '')).restored).toEqual(['Limits of this report']);
      const dashed = before.replace('The sources do not cover long-term follow-up.', 'An opening sentence. Costs - not reported - are outside the sources.');
      expect(guardLockedRepair(dashed, dashed.replace('An opening sentence. Costs ', '')).restored).toEqual(['Limits of this report']);
    });

    it('does not let a parent sub-heading go while its child stays', () => {
      const tree = before.replace('The sources do not cover long-term follow-up.', '### Parent\nAn introduction [P1].\n#### Child\nA detail [P2].');
      expect(guardLockedRepair(tree, tree.replace('### Parent\nAn introduction [P1].\n', '')).restored).toEqual(['Limits of this report']);
      expect(guardLockedRepair(tree, tree.replace('\n#### Child\nA detail [P2].', '')).restored).toEqual([]);
    });

    it('does not let a heading the section has be written twice', () => {
      const withSub = before.replace('## Limits of this report\n', '## Limits of this report\n### Scope\n');
      expect(guardLockedRepair(withSub, withSub).restored).toEqual([]);
      const doubled = withSub.replace('The sources do not cover long-term follow-up.', 'The sources do not cover long-term follow-up.\n### Scope\n');
      expect(guardLockedRepair(withSub, doubled).restored).toEqual(['Limits of this report']);
    });

    it('does not accept a changed sign, a reordered pair of sentences or a swapped pair of headings', () => {
      const figures = before.replace('The sources do not cover long-term follow-up.', '### Benefits\nThe margin was +5 percent [P1].\n### Harms\nCrises fell in the first year [P2]. Costs were not reported [P2].');
      expect(guardLockedRepair(figures, figures).restored).toEqual([]);
      expect(guardLockedRepair(figures, figures.replace('+5 percent', '-5 percent')).restored).toEqual(['Limits of this report']);
      expect(guardLockedRepair(figures, figures.replace('Crises fell in the first year [P2]. Costs were not reported [P2].', 'Costs were not reported [P2]. Crises fell in the first year [P2].')).restored).toEqual(['Limits of this report']);
      expect(guardLockedRepair(figures, figures.replace('### Benefits', '### X').replace('### Harms', '### Benefits').replace('### X', '### Harms')).restored).toEqual(['Limits of this report']);
      // A sub-heading cut while what was under it stays would file it under the heading above.
      expect(guardLockedRepair(figures, figures.replace('### Harms\n', '')).restored).toEqual(['Limits of this report']);
      // A sub-heading cut with everything under it is a cut.
      expect(guardLockedRepair(figures, figures.replace('\n### Harms\nCrises fell in the first year [P2]. Costs were not reported [P2].', '')).restored).toEqual([]);
      // Cutting one of them is still a cut.
      expect(guardLockedRepair(figures, figures.replace(' Costs were not reported [P2].', '')).restored).toEqual([]);
    });

    it('keeps the report\'s own heading line and does not accept a change of indentation', () => {
      const sharp = before.replace('## Limits of this report', '## C# limits');
      const guarded = guardLockedRepair(sharp, sharp.replace('## C# limits', '## C limits'));
      expect(guarded.markdown).toContain('## C# limits\nThe sources do not cover long-term follow-up.');
      expect(guarded.markdown).not.toContain('## C limits');
      expect(guardLockedRepair(before, before.replace('The sources do not cover', '    The sources do not cover')).restored).toEqual(['Limits of this report']);
      // Spaces left at the end of a line are not content.
      expect(guardLockedRepair(before, before.replace('long-term follow-up.', 'long-term follow-up.   ')).restored).toEqual([]);
    });

    it('does not accept a list run together into a line or a table flattened', () => {
      const shaped = before.replace('The sources do not cover long-term follow-up.', 'The gaps are these.\n- No long-term follow-up.\n- No pricing.\n\n| Year | Event |\n| --- | --- |\n| 2023 | Approval |');
      expect(guardLockedRepair(shaped, shaped).restored).toEqual([]);
      expect(guardLockedRepair(shaped, shaped.replace('The gaps are these.\n- No long-term', 'The gaps are these. - No long-term')).restored).toEqual(['Limits of this report']);
      expect(guardLockedRepair(shaped, shaped.replace('| Year | Event |\n| --- | --- |\n| 2023 | Approval |', '| Year | Event | | --- | --- | | 2023 | Approval |')).restored).toEqual(['Limits of this report']);
      expect(guardLockedRepair(shaped, shaped.replace('The gaps are these.\n- No', '> The gaps are these.\n- No')).restored).toEqual(['Limits of this report']);
      // Cutting a list item, or the sentence that opens a paragraph, is a cut.
      // A section that holds a table is taken unchanged or not at all.
      expect(guardLockedRepair(shaped, shaped.replace('- No long-term follow-up.\n', '')).restored).toEqual(['Limits of this report']);
      // In a section of plain bullets, cutting one is a cut.
      expect(guardLockedRepair(before, before.replace('- Eligible patients have recurrent crises [P2].', '').replace('2023 [P1].\n\n\n## Limits', '2023 [P1].\n\n## Limits')).restored).toEqual([]);
      expect(guardLockedRepair(before, before.replace('The FDA approved Casgevy on 8 December 2023 [P1]. ', '')).restored).toEqual([]);
    });

    it('does not accept a code block left open by a cut', () => {
      const coded = before.replace('The sources do not cover long-term follow-up.', 'The command is this.\n\n```text\nrun --all.\n```\n\nNothing else is covered.');
      expect(guardLockedRepair(coded, coded).restored).toEqual([]);
      expect(guardLockedRepair(coded, coded.replace('run --all.\n```\n', 'run --all.\n')).restored).toEqual(['(whole report)']);
      // Both fences taken off, leaving what the block quoted as part of the report.
      const quoted = before.replace('The sources do not cover long-term follow-up.', 'An example follows.\n\n```markdown\n### Pricing\nIt costs two million dollars.\n```\n\nNothing else is covered.');
      expect(guardLockedRepair(quoted, quoted.replace('```markdown\n', '').replace('\n```\n', '\n')).restored).toEqual(['(whole report)']);
      const longer = quoted.replace('```markdown', '````markdown').replace('\n```\n', '\n````\n');
      expect(guardLockedRepair(longer, longer).restored).toEqual([]);
      expect(guardLockedRepair(longer, longer.replace('````markdown\n', '').replace('\n````\n', '\n')).restored).toEqual(['(whole report)']);
      // A section holding a code block is taken unchanged or not at all, so even a clean cut of the block puts it back.
      expect(guardLockedRepair(coded, coded.replace('```text\nrun --all.\n```\n\n', '')).restored).toEqual(['(whole report)']);
      // The same for an HTML comment, and for a reference link and its definition.
      const hidden = before.replace('The sources do not cover long-term follow-up.', 'The sources stop in 2023.\n\n<!--\n\nIt costs two million dollars.\n\n-->');
      expect(guardLockedRepair(hidden, hidden.replace('<!--\n\n', '').replace('\n\n-->', '')).restored).toEqual(['(whole report)']);
      // Raw HTML can hold a line that looks like a heading. Such a report is not taken apart.
      const raw = before.replace('The sources do not cover long-term follow-up.', 'An example follows.\n\n<pre>\n## literal heading\ntext\n</pre>');
      expect(guardLockedRepair(raw, raw)).toEqual({ markdown: raw, restored: [], dropped: [] });
      expect(guardLockedRepair(raw, raw.replace('An example follows.\n\n', '')).restored).toEqual(['(whole report)']);
    });

    it('does not accept a cut from a numbered list, which would renumber what is left', () => {
      const ranked = before.replace('The sources do not cover long-term follow-up.', 'The gaps, in order of weight.\n\n1. No long-term follow-up.\n1. No price data [P2].');
      expect(guardLockedRepair(ranked, ranked).restored).toEqual([]);
      expect(guardLockedRepair(ranked, ranked.replace('1. No long-term follow-up.\n', '')).restored).toEqual(['Limits of this report']);
      const referenced = before.replace('The sources do not cover long-term follow-up.', 'The [FDA][agency] has more.\n\n[agency]: https://www.fda.gov/source');
      expect(guardLockedRepair(referenced, referenced).restored).toEqual([]);
      expect(guardLockedRepair(referenced, referenced.replace('\n\n[agency]: https://www.fda.gov/source', '')).restored).toEqual(['Limits of this report']);
      // Other sections of the same report can still be cut.
      expect(guardLockedRepair(referenced, referenced.replace(' It treats sickle cell disease in patients aged 12 and older [P1, P2].', '')).restored).toEqual([]);
    });

    it('keeps a list item or a quoted line whole, or cuts it whole', () => {
      const listed = before.replace('- The approval came on 8 December 2023 [P1].', '- Background first. The approval came on 8 December 2023 [P1].');
      // The bullet taken off the sentence that is kept.
      expect(guardLockedRepair(listed, listed.replace('- Background first. The approval', 'The approval')).restored).toEqual(['Key findings']);
      // Half an item cut, bullet kept: still not the item the report had.
      expect(guardLockedRepair(listed, listed.replace('- Background first. The approval', '- The approval')).restored).toEqual(['Key findings']);
      // The whole item cut.
      expect(guardLockedRepair(listed, listed.replace('- Background first. The approval came on 8 December 2023 [P1].\n', '')).restored).toEqual([]);
      const quotedLine = before.replace('The sources do not cover long-term follow-up.', '> The agency said this.\nIt applies to patients aged 12 and older [P2].');
      expect(guardLockedRepair(quotedLine, quotedLine.replace('> The agency said this.\n', '')).restored).toEqual(['Limits of this report']);
      const runOn = before.replace('- Eligible patients have recurrent crises [P2].', '- Eligible patients have recurrent crises [P2].\nThis continues the item.');
      expect(guardLockedRepair(runOn, runOn.replace('- Eligible patients have recurrent crises [P2].\n', '')).restored).toEqual(['Key findings']);
    });

    it('is the step a locked repair goes through in a run, and an unlocked repair does not', () => {
      const source = readFileSync(resolve(process.cwd(), 'src/services/reasoning/researchOrchestrator.ts'), 'utf8');
      const repair = source.slice(source.indexOf('const beforeRepair = generatedReport.markdown;'), source.indexOf('ensureGeneratedTitleHeading(generatedReport.markdown, researchQuery, orchProfile.intent);', source.indexOf('const beforeRepair = generatedReport.markdown;')));
      expect(repair).toMatch(/if \(lockedPassages\) \{[\s\S]*guardLockedRepair\(beforeRepair, generatedReport\.markdown\)[\s\S]*generatedReport\.markdown = guarded\.markdown;[\s\S]*stripUnsupportedMarkers\(beforeRepair, generatedReport\.markdown\)/);
      // The guard is reached only inside the lock branch.
      expect(repair.indexOf('guardLockedRepair(')).toBeGreaterThan(repair.indexOf('if (lockedPassages) {'));
      expect(source).toContain('lockedPassages ? `${LOCKED_REPAIR_RULE}\\n\\n${repairPlan.userPrompt}` : repairPlan.userPrompt');
      expect(source).toMatch(/missingRequirements: lockedPassages\s*\?\s*\[\]/);
    });

    it('tells the repair what it may not do', () => {
      expect(LOCKED_REPAIR_RULE).toContain('Do not remove a citation from a sentence you keep.');
      expect(LOCKED_REPAIR_RULE).toContain('you may only cut');
      expect(LOCKED_REPAIR_RULE).toContain('Return every section you were shown');
      expect(LOCKED_REPAIR_RULE).toContain('do not add a sentence, a citation, a source, a link, a heading or a section');
    });
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

  it('reads a number written with spaces or as a link as the citation it is', () => {
    const base = [{ key: 'a', content: 'The bridge opened in 1932 [1]. It was repainted later [2].' }];
    const rows = [
      { sectionKey: 'a', citationText: '[1]', row: 'first' },
      { sectionKey: 'a', citationText: '[2]', row: 'second' },
    ];
    const kept = rebindRevisedCitations(base, rows, [
      { key: 'a', content: 'The bridge opened in 1932 [ 1 ]. It was repainted later [2](https://example.org/x). A new line.' },
    ]);
    expect(kept.contents).toEqual(['The bridge opened in 1932 [1]. It was repainted later [2]. A new line.']);
    expect(kept.kept.map((entry) => entry.row)).toEqual(['first', 'second']);

    const dropped = rebindRevisedCitations(base, rows, [
      { key: 'a', content: 'The bridge was finished early [ 1 ]. Paint came much later [2](https://example.org/x). See [2023](https://example.org/y) and `[1](z)`.' },
    ]);
    expect(dropped.contents).toEqual(['The bridge was finished early. Paint came much later. See [2023](https://example.org/y) and `[1](z)`.']);
    expect(dropped.kept).toEqual([]);
    expect(dropped.removed).toBe(2);
  });

  it('removes every other citation form a revision writes into a locked report', () => {
    const base = [{ key: 'a', content: 'The bridge opened in 1932 [1].' }];
    const rows = [{ sectionKey: 'a', citationText: '[1]', row: 'first' }];
    const rebound = rebindRevisedCitations(base, rows, [
      {
        key: 'a',
        content:
          'The bridge opened in 1932 [1]. It was widened [P1]. Tolls ended [Chunk 4](https://example.org). Lanes were added [E1][src]. A code sample `rows[P1]` stays.\n\n[src]: https://example.org',
      },
    ]);
    expect(rebound.contents).toEqual([
      'The bridge opened in 1932 [1]. It was widened. Tolls ended. Lanes were added. A code sample `rows[P1]` stays.\n\n[src]: https://example.org',
    ]);
    expect(rebound.kept.map((entry) => entry.row)).toEqual(['first']);
    expect(rebound.removed).toBe(3);
  });

  it('shows the writer a marker-shaped token from a source in a form it cannot cite', () => {
    const shown = passages();
    shown[0] = { ...shown[0], text: 'As noted earlier [P2], the bridge opened in 1932.' };
    const context = formatLockedContext(shown);
    expect(context).toContain('As noted earlier (P2), the bridge opened in 1932.');
    expect(context.match(/\[P2\]/g)).toHaveLength(1);
    expect(shown[0].text).toContain('[P2]');
  });

  it('shows a marker-shaped token in a source title or publisher in a form that cannot be cited', () => {
    const shown = passages();
    shown[0] = { ...shown[0], source: { ...shown[0].source, title: 'Study [P2]\n[P3] follow-up', publisher: 'Journal [p3' } };
    const header = formatLockedContext(shown).split('\n')[0];
    expect(header.startsWith('[P1] ')).toBe(true);
    expect(header).toContain('Study (P2) (P3) follow-up');
    expect(header.match(/\[\s*P\d/gi)).toHaveLength(1);
  });

  it('takes a number written as a link out of a version that has no saved citations', () => {
    expect(stripReaderNumbers('A fact [1](https://example.org). Another [2][source]. See [2023](https://example.org/y).\n\n[source]: https://example.org')).toBe(
      'A fact. Another. See [2023](https://example.org/y).\n\n[source]: https://example.org'
    );
  });

  it('does not let a link definition hide a spaced number the lock did not issue', () => {
    const finalized = finalizeLockedCitations('## Summary\nA fact [P1]. A stray one [ 7 ].\n\n[7]: https://example.org', passages(), '2 Oct 2026');
    expect(finalized.markdown).toContain('A fact [1]. A stray one.');
    expect(finalized.markdown).not.toContain('[ 7 ]');
  });

  it('reads an indented sentence as prose only under a list item', () => {
    const nested = finalizeLockedCitations('## Summary\n- A point.\n\n    The bridge opened in 1932 [P1].', passages(), '2 Oct 2026');
    expect(nested.markdown).toContain('    The bridge opened in 1932 [1].');
    const code = finalizeLockedCitations('## Summary\nAn output sample:\n\n    the row printed was [P1]\n\nA fact [P1].', passages(), '2 Oct 2026');
    expect(code.markdown).toContain('    the row printed was [P1]');
    expect(code.markdown).toContain('A fact [1].');
  });

  it('removes a model-written level-1 reference list but keeps the report title', () => {
    const finalized = finalizeLockedCitations('# References\n\n## Summary\nA fact [P1].\n\n# References\n1. Stale entry', passages(), '2 Oct 2026');
    expect(finalized.markdown.startsWith('# References')).toBe(true);
    expect(finalized.markdown).not.toContain('Stale entry');
    expect(finalized.markdown.match(/^#{1,3} References$/gm)).toHaveLength(2);
    expect(finalized.markdown).toContain('A fact [1].');
  });

  it('removes a model-written reference list at any heading depth', () => {
    const finalized = finalizeLockedCitations('## Summary\nA fact [P1].\n\n#### References\n1. Stale entry\n\n#### About this report\nStale note.', passages(), '2 Oct 2026');
    expect(finalized.markdown).not.toContain('Stale');
    expect(finalized.markdown.match(/^#+ References$/gm)).toHaveLength(1);
    expect(finalized.markdown.match(/^#+ About this report$/gm)).toHaveLength(1);
  });

  it('reads a citation written as a link when numbering', () => {
    const finalized = finalizeLockedCitations(
      '## Summary\nA fact [P1](https://example.org/a). A stray one [7](https://example.org/b). An old form [Chunk 4](https://example.org/c). See [2023](https://example.org/d).',
      passages(),
      '2 Oct 2026'
    );
    expect(finalized.markdown).toContain('A fact [1]. A stray one. An old form. See [2023](https://example.org/d).');
    expect(finalized.occurrences).toHaveLength(1);
  });

  it('reads nested list prose by where it sits, whatever its shape', () => {
    const finalized = finalizeLockedCitations(
      '## Summary\n- A point.\n    - Detail [Chunk 4].\n\n    Confirmed [P1].\n\n        rows[P1] = 1',
      passages(),
      '2 Oct 2026'
    );
    expect(finalized.markdown).toContain('    - Detail.');
    expect(finalized.markdown).toContain('    Confirmed [1].');
    expect(finalized.markdown).toContain('        rows[P1] = 1');
  });

  it('leaves a list-shaped indented line as code when no list is above it', () => {
    const finalized = finalizeLockedCitations('## Summary\nA sample:\n\n    - example [P1]\n\nA fact [P1].', passages(), '2 Oct 2026');
    expect(finalized.markdown).toContain('    - example [P1]');
    expect(finalized.markdown).toContain('A fact [1].');
  });

  it('does not let a broken marker swallow the sentence and the citation after it', () => {
    const finalized = finalizeLockedCitations('## Summary\nA claim [P1 broken text. A fact [P2].', passages(), '2 Oct 2026');
    expect(finalized.markdown).toContain('A claim broken text. A fact [1].');
    expect(finalized.occurrences).toHaveLength(1);
  });

  it('removes a model-written reference list whose heading closes with hashes', () => {
    const finalized = finalizeLockedCitations('## Summary\nA fact [P1].\n\n## References ##\n1. Stale entry', passages(), '2 Oct 2026');
    expect(finalized.markdown).not.toContain('Stale entry');
    expect(finalized.markdown.match(/^#+ References\b/gm)).toHaveLength(1);
  });

  it('removes a marker the model never closed', () => {
    const finalized = finalizeLockedCitations('## Summary\nA claim [P1\nA fact [P1]. Another claim [P2 and more words.', passages(), '2 Oct 2026');
    expect(finalized.markdown).toContain('A claim\nA fact [1]. Another claim and more words.');
    expect(finalized.markdown).not.toMatch(/\[P\d/);
  });

  it('reads a reference-style link by its label when deciding whether a sentence changed', () => {
    const base = [{ key: 'a', content: 'The [FDA][source] authorized it [1]. A second line.\n\n[source]: https://example.org' }];
    const rows = [{ sectionKey: 'a', citationText: '[1]', row: 'first' }];
    const same = rebindRevisedCitations(base, rows, [
      { key: 'a', content: 'The [FDA][source] authorized it [1]. A new second line.\n\n[source]: https://example.org' },
    ]);
    expect(same.kept.map((entry) => entry.row)).toEqual(['first']);
    const changed = rebindRevisedCitations(base, rows, [{ key: 'a', content: 'The FDA source authorized it [1]. A second line.' }]);
    expect(changed.kept).toEqual([]);
    expect(changed.contents).toEqual(['The FDA source authorized it. A second line.']);
  });

  it('reads a linked number in nested list prose during a revision', () => {
    const base = [{ key: 'a', content: '- A point.\n\n    The bridge opened in 1932 [1].' }];
    const rows = [{ sectionKey: 'a', citationText: '[1]', row: 'first' }];
    const kept = rebindRevisedCitations(base, rows, [
      { key: 'a', content: '- A point.\n\n    The bridge opened in 1932 [1](https://example.org). It has `rows[1](x)` in code.' },
    ]);
    expect(kept.contents).toEqual(['- A point.\n\n    The bridge opened in 1932 [1]. It has `rows[1](x)` in code.']);
    expect(kept.kept.map((entry) => entry.row)).toEqual(['first']);
    const dropped = rebindRevisedCitations(base, rows, [{ key: 'a', content: '- A point.\n\n    It was finished early [1](https://example.org).' }]);
    expect(dropped.contents).toEqual(['- A point.\n\n    It was finished early.']);
  });

  it('measures code inside a list from where the item text begins', () => {
    const finalized = finalizeLockedCitations(
      '## Summary\n- A point [P1].\n\n      rows[P2] = sample [P2]\n\n1. A step.\n\n    Still the step [P1].\n\n       code under the step [P2]',
      passages(),
      '2 Oct 2026'
    );
    // Six spaces under "- " is four past the item text: code. Four spaces under "1. " is one past: prose.
    expect(finalized.markdown).toContain('      rows[P2] = sample [P2]');
    expect(finalized.markdown).toContain('    Still the step [1].');
    expect(finalized.markdown).toContain('       code under the step [P2]');
    expect(finalized.occurrences).toHaveLength(2);
  });

  it('narrows only subject and item sections; every template section sees the whole report', () => {
    expect(isSubjectSection({ key: 'topic_1' })).toBe(true);
    expect(isSubjectSection({ key: 'opportunities_3', itemOrdinal: 3 })).toBe(true);
    const keys = Object.values(INTENT_OUTPUT_TEMPLATES).flatMap((template) => [...template.sections]);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of [...keys, 'summary', 'key_findings', 'direct_answer', 'sources', 'confidence', 'recommendation', 'recommendations', 'caveats']) {
      expect(isSubjectSection({ key })).toBe(false);
    }
  });

  it('binds citations in a report whose opening section is named like a system section', () => {
    const finalized = finalizeLockedCitations('# References\nA fact [P1].\n\n## Use\nAnother [P2].', passages(), '2 Oct 2026');
    const bound = assignOccurrencesToSections(sectionsOf(finalized.markdown), finalized.occurrences);
    expect(bound.map((row) => row.sectionOrder)).toEqual([1, 2]);
    const renumbered = renumberAfterRevision(
      [
        { title: 'References', content: 'A fact [2].' },
        { title: 'References', content: '1. First\n2. Second' },
      ],
      ['[2]']
    );
    expect(renumbered.contents).toEqual(['A fact [1].', '1. Second']);
    expect(renumbered.citationTexts).toEqual(['[1]']);
  });

  it('removes an unsupported marker written as a link without leaving the link behind', () => {
    const repaired = stripUnsupportedMarkers('A fact [P1].', 'A fact [P1]. A new claim [P2](https://example.org). Another [P2][].');
    expect(repaired.markdown).toBe('A fact [P1]. A new claim. Another.');
    expect(stripUnknownMarkers('A claim [P9](https://example.org). A fact [P1][].', passages())).toBe('A claim. A fact [P1].');
  });

  it('takes banned wording out of prose and leaves code and link destinations alone', () => {
    const section =
      'The verdict was clear [P1]. See [the ruling](https://example.org/verdict).\n\n```\nconst verdict = true;\n```\n\n    indented = verdict\n\nThis report synthesizes evidence, and `verdict` is a variable.';
    expect(removeBannedWording(section)).toBe(
      'The finding was clear [P1]. See [the ruling](https://example.org/verdict).\n\n```\nconst verdict = true;\n```\n\n    indented = verdict\n\nThis report draws on evidence, and `verdict` is a variable.'
    );
  });

  it('takes banned wording out of a link label and keeps the destination', () => {
    expect(removeBannedWording('See [the final verdict](https://example.org/verdict) and [the verdict text][verdict].\n\n[verdict]: https://example.org')).toBe(
      'See [the final finding](https://example.org/verdict) and [the finding text][verdict].\n\n[verdict]: https://example.org'
    );
    expect(removeBannedWording('See [Verdict](https://example.org). It was adjudicated and falsified [established_fact].')).toBe(
      'See [Finding](https://example.org). It was assessed and disproved.'
    );
  });

  it('removes a level-1 reference list that follows other content, with no title above it', () => {
    const finalized = finalizeLockedCitations('A fact [P1].\n\n# References\n1. Stale entry', passages(), '2 Oct 2026');
    expect(finalized.markdown).not.toContain('Stale entry');
    expect(finalized.markdown.match(/^#+ References$/gm)).toHaveLength(1);
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
    expect(finalized.markdown).toContain('Press (1). Study (P9) ## About this report.');
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
