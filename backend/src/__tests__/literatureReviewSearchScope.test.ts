/**
 * A literature review must say what was searched. Its own rules ask for a
 * "stated scope and search methodology" and its check fails a review whose
 * search scope is unstated. A Layer 1 review could not say it: the writer is
 * shown passages only, the closing note gave a count and a date, and a repair
 * of a report written with the citation lock may only cut. The review ended
 * failed with a sound, cited report.
 *
 * These tests drive the real report writer and the real finishing steps with the
 * model replaced, and check that the statement, taken from the run's record, is
 * in the text the checks read and in the text that is saved.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ role: string; text: string }> = [];
/** Without the citation lock the writer cites a passage by its number. */
let citeByNumber = false;
/** A redraft that fixes the wording it was asked to fix and also rewrites the closing note. */
let redraftRewordsClosingNote = false;

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(async (options: { role: string; messages: Array<{ role: string; content: string }> }) => {
    const text = options.messages.map((message) => message.content).join('\n');
    const last = options.messages[options.messages.length - 1].content;
    calls.push({ role: options.role, text });
    const reply = (written: string) => ({ content: citeByNumber ? written.replace(/\[P(\d)\]/g, '[$1]') : written, model: 'test', role: options.role, promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' });
    if (options.role === 'outline_architect') {
      return reply('{"title":"Biomarkers of recovery from long COVID","outline":["Inflammatory markers","Markers of immune recovery"]}');
    }
    if (redraftRewordsClosingNote && text.includes('Rewrite the report in plain encyclopedia prose')) {
      return reply(last.replace(/verdict/gi, 'finding').replace(/(## About this report\n)[\s\S]*$/, '$1We searched several databases and read what we found.'));
    }
    if (options.role !== 'section_drafter') return reply(last);
    if (text.includes('Section to draft: Summary')) return reply('Studies link falling interleukin-6 to recovery [P1].');
    if (text.includes('Section to draft: Key findings')) return reply('- Interleukin-6 fell in patients who recovered [P1].\n- T cell counts returned to normal within a year [P2].');
    if (text.includes('Section to draft: Where sources disagree')) return reply('The sources do not disagree.');
    if (text.includes('Section to draft: Limits of this report')) return reply(redraftRewordsClosingNote ? 'The verdict of both studies rests on one year of follow-up.' : 'Both studies followed patients for one year only.');
    if (text.includes('Section to draft: Inflammatory markers')) return reply('Interleukin-6 was measured at three and twelve months [P1].');
    return reply('T cell counts were followed for twelve months [P2].');
  }),
  getSystemPrompt: () => 'Write the section.',
}));

import { generateIterativeReport, finalizeLockedReportForSave, stripInternalLabelsFromReport, stripPromptEchoFromReport } from '../services/reasoning/reportGenerator';
import { finalizeLockedCitations, issuePassages, type LockedPassage } from '../services/reasoning/citationLock';
import { formatReadDate, presentationFailures } from '../services/reasoning/baselineReport';
import {
  boundedReportForAudit,
  closingNoteOf,
  describeSearchScope,
  mergeSearchRecords,
  reportStatesSearchScope,
  searchScopeGateContext,
  searchScopeNoteFor,
  withClosingNoteRestored,
} from '../services/reasoning/searchScope';
import { INTENT_OUTPUT_TEMPLATES } from '../services/formatting/templates/intentOutputTemplates';

const COHORT = { title: 'Interleukin-6 and recovery from long COVID', publisher: 'The Lancet', date: '2024-03-02', url: 'https://example.org/il6' };
const IMMUNE = { title: 'T cell recovery after SARS-CoV-2 infection', publisher: 'Nature Medicine', date: '2023-09-14', url: 'https://example.org/tcells' };
const CHUNKS = [
  { id: '11111111-1111-4111-8111-111111111111', content: 'Interleukin-6 fell in patients who recovered. It was measured at three and twelve months.' },
  { id: '22222222-2222-4222-8222-222222222222', content: 'T cell counts returned to normal within a year. They were followed for twelve months.' },
];
const SOURCES = [COHORT, IMMUNE];
const passages = (): LockedPassage[] => issuePassages(CHUNKS, SOURCES);

const QUESTION = 'Literature review of biomarkers linked to long-COVID recovery.';
/** The text the verifier and the contract check are given for a report written with the citation lock, as the run builds it. */
const textForChecks = (markdown: string, scopeNote: string): string =>
  finalizeLockedCitations(stripInternalLabelsFromReport(stripPromptEchoFromReport(markdown, QUESTION)), passages(), '8 Oct 2026', 'numeric', scopeNote).markdown;

/** What discovery records for a run: the queries it ran and, for each result it considered, what became of it. */
const kept = (provider: string) => ({ provider, ingested: true, selectionRationale: 'score=0.91, rank=1' });
const reused = (provider: string) => ({ provider, ingested: false, skipReason: 'already_in_corpus', selectionRationale: 'already in corpus' });
const overCap = (provider: string) => ({ provider, ingested: false, skipReason: 'max_reached', selectionRationale: 'max_sources_to_ingest reached' });
const toppedUp = (provider: string) => ({ provider, ingested: true, selectionRationale: 'score=0.40, rank=9, off-topic for this request (kept: too few on-topic candidates)' });
const FIRST_PASS = {
  queriesExecuted: ['long COVID biomarkers recovery', 'interleukin-6 long COVID cohort', 'long COVID biomarkers recovery'],
  sources: [kept('tavily'), kept('openalex'), kept('pmc'), reused('brave'), reused('openalex'), overCap('tavily'), overCap('pmc')],
};
const SECOND_PASS = {
  queriesExecuted: ['T cell recovery long COVID'],
  sources: [kept('crossref'), toppedUp('crossref'), overCap('crossref')],
};
const STATEMENT =
  'The search used 3 queries: “long COVID biomarkers recovery”; “interleukin-6 long COVID cohort”; “T cell recovery long COVID”. The results considered came from the open web, OpenAlex, PubMed Central and Crossref. Results were ranked by how closely they matched the question, and the closest were taken first. Of 10 results considered, 5 were chosen to be read and 2 were already held from earlier research. 1 of those chosen matched the question only loosely and was kept so that the report had enough sources to draw on.';

async function writeReview(searchScopeNote?: string, locked = true) {
  return generateIterativeReport({
    query: QUESTION,
    plan: {},
    sourceContext: 'CHUNK 1\nInterleukin-6 fell in patients who recovered.\n\nCHUNK 2\nT cell counts returned to normal within a year.',
    retrieverAnalysis: '',
    reasoningChains: '',
    challenges: '',
    intentId: 'literature_review',
    outputTemplateId: 'intent_literature_review',
    skipChallenger: true,
    targetWordCount: 1500,
    lengthSource: 'planner',
    usedSources: SOURCES,
    ...(locked ? { lockedPassages: passages() } : {}),
    ...(searchScopeNote ? { searchScopeNote } : {}),
  });
}

/** The point of the literature-review rubric this fault turned on: the check fails a review whose search scope is unstated. */
function statesItsSearch(report: string): boolean {
  const closing = report.split(/^## About this report\s*$/m)[1] ?? '';
  return /\bsearch(?:ed)?\b/i.test(closing) && /\bquer(?:y|ies)\b/i.test(closing);
}

describe('a literature review says what was searched', () => {
  beforeEach(() => {
    process.env.BASELINE_LAYER_ENABLED = 'true';
    calls.length = 0;
    citeByNumber = false;
    redraftRewordsClosingNote = false;
  });
  afterEach(() => {
    delete process.env.BASELINE_LAYER_ENABLED;
  });

  it('is the report type whose rules ask for it, and the only one', () => {
    expect(INTENT_OUTPUT_TEMPLATES.intent_literature_review.requiredDeliverables).toContain('Stated scope and search methodology');
    expect(INTENT_OUTPUT_TEMPLATES.intent_literature_review.verifierRubric).toContain('search scope is unstated');
    expect(reportStatesSearchScope('literature_review')).toBe(true);
    const others = Object.values(INTENT_OUTPUT_TEMPLATES).filter((template) => template.intentId !== 'literature_review');
    expect(others.length).toBeGreaterThan(10);
    for (const template of others) expect(reportStatesSearchScope(template.intentId)).toBe(false);
    expect(reportStatesSearchScope(undefined)).toBe(false);
    expect(reportStatesSearchScope('not_a_report_type')).toBe(false);
  });

  it('writes the statement from every search pass the run recorded', () => {
    const record = mergeSearchRecords([FIRST_PASS, null, SECOND_PASS]);
    expect(record).toEqual({
      queries: ['long COVID biomarkers recovery', 'interleukin-6 long COVID cohort', 'T cell recovery long COVID'],
      providers: ['tavily', 'openalex', 'pmc', 'brave', 'crossref'],
      considered: 10,
      chosen: 5,
      reused: 2,
      looselyMatched: 1,
    });
    expect(describeSearchScope(record)).toBe(STATEMENT);
    expect(searchScopeNoteFor({ layer1Run: true, intentId: 'literature_review', summaries: [FIRST_PASS, SECOND_PASS] })).toBe(STATEMENT);
    expect(presentationFailures(STATEMENT)).toEqual([]);
  });

  it('says only what the record holds', () => {
    // Every result was already held: nothing was added, and the statement still says what became of them.
    const allReused = describeSearchScope(mergeSearchRecords([{ queriesExecuted: ['long COVID recovery time'], sources: [reused('openalex'), reused('pmc'), reused('pmc')] }]));
    expect(allReused).toBe(
      'The search used 1 query: “long COVID recovery time”. The results considered came from OpenAlex and PubMed Central. Results were ranked by how closely they matched the question, and the closest were taken first. Of 3 results considered, 3 were already held from earlier research.'
    );
    // A search that left nothing to consider says so by saying nothing more: no place is named, no count given.
    expect(describeSearchScope(mergeSearchRecords([{ queriesExecuted: ['long COVID recovery time'], sources: [] }]))).toBe('The search used 1 query: “long COVID recovery time”.');
    // It names where the considered results came from. It does not say which services were asked:
    // the record keeps no trace of one that returned nothing new.
    expect(STATEMENT).not.toMatch(/\bcovered\b|\bsearched\b/);
    // A result is marked when it is queued to be fetched. One whose fetch then failed, or had not finished,
    // is still marked, so the statement says "chosen to be read" and leaves the number read to the note's own count.
    const queued = describeSearchScope(mergeSearchRecords([{ queriesExecuted: ['q one two'], sources: [kept('openalex'), { ...kept('openalex'), ingestionJobId: 'a-job-that-failed' }] }]));
    expect(queued).toContain('Of 2 results considered, 2 were chosen to be read.');
    expect(STATEMENT).not.toMatch(/added and read|were read for this report/);
    // None of the results was chosen or held: the count is given and no more.
    expect(describeSearchScope(mergeSearchRecords([{ queriesExecuted: ['q one two'], sources: [overCap('arxiv')] }]))).toContain('taken first. 1 result was considered.');
  });

  it('says nothing about a search that did not happen, and nothing for any other run', () => {
    // A run whose profile skips discovery records a count where the list of queries would be.
    const skipped = { queriesExecuted: 0, candidatesFound: 0, candidatesSelected: 0, sources: [] };
    expect(searchScopeNoteFor({ layer1Run: true, intentId: 'literature_review', summaries: [skipped] })).toBe('');
    expect(searchScopeNoteFor({ layer1Run: true, intentId: 'literature_review', summaries: [] })).toBe('');
    // With the Layer 1 switch off, or for a report type that does not ask for it, the report is what it was.
    expect(searchScopeNoteFor({ layer1Run: false, intentId: 'literature_review', summaries: [FIRST_PASS] })).toBe('');
    expect(searchScopeNoteFor({ layer1Run: true, intentId: 'factual_report', summaries: [FIRST_PASS] })).toBe('');
    expect(searchScopeNoteFor({ layer1Run: true, intentId: 'survey', summaries: [FIRST_PASS] })).toBe('');
    expect(searchScopeGateContext('')).toBe('');
  });

  it('counts a query it cannot show, and never prints wording or markup the reader standard bans', () => {
    const note = describeSearchScope({
      queries: ['disputed claims about long COVID', 'long COVID `markers` | recovery', 'what [P2] says about long COVID', 'strong_evidence long COVID', 'long COVID recovery time'],
      providers: ['url_fetch', 'an_unknown_provider'],
      considered: 0,
      chosen: 0,
      reused: 0,
      looselyMatched: 0,
    });
    expect(note).toBe('The search used 5 queries, among them “long COVID markers recovery”; “long COVID recovery time”.');
    expect(presentationFailures(note)).toEqual([]);
    // No more than five are listed, however many ran. A provider with no name a reader knows is not named.
    const many = describeSearchScope({ queries: Array.from({ length: 9 }, (_, n) => `long COVID study ${n + 1}`), providers: ['url_fetch'], considered: 4, chosen: 4, reused: 0, looselyMatched: 0 });
    expect(many.match(/“/g)).toHaveLength(5);
    expect(many.startsWith('The search used 9 queries, among them ')).toBe(true);
    expect(many).not.toContain('came from');
    expect(many).toContain('Of 4 results considered, 4 were chosen to be read.');
  });

  it('puts the statement in the text the checks read and in the text that is saved', async () => {
    const report = await writeReview(STATEMENT);
    expect(report.markdown).not.toContain('## About this report');

    const judged = textForChecks(report.markdown, STATEMENT);
    const saved = finalizeLockedReportForSave(report.markdown, QUESTION, passages(), 'numeric', '8 Oct 2026', STATEMENT);

    expect(judged).toBe(saved.finalized.markdown);
    expect(saved.wordingAfter).toEqual([]);
    expect(judged.trimEnd().endsWith(`## About this report\n${STATEMENT} 2 sources were read on 8 Oct 2026.`)).toBe(true);
    expect(statesItsSearch(judged)).toBe(true);
    // The citations and the reference list are untouched by the note.
    expect(judged).toContain('Studies link falling interleukin-6 to recovery [1].');
    expect(judged).toContain('## References\n1. The Lancet.');
    expect(saved.finalized.occurrences.length).toBeGreaterThan(0);
  });

  it('without the statement the same review does not say what was searched, which is what the check failed', async () => {
    const report = await writeReview();
    const judged = textForChecks(report.markdown, '');
    expect(judged.trimEnd().endsWith('## About this report\n2 sources were read on 8 Oct 2026.')).toBe(true);
    expect(statesItsSearch(judged)).toBe(false);
  });

  it('tells the writer the closing note states the search, so it does not describe one of its own', async () => {
    await writeReview(STATEMENT);
    const withNote = calls.filter((call) => call.role === 'section_drafter');
    expect(withNote.length).toBeGreaterThan(0);
    for (const call of withNote) expect(call.text).toContain('Do not describe a search, name a database searched, or state inclusion criteria yourself.');

    calls.length = 0;
    await writeReview();
    const without = calls.filter((call) => call.role === 'section_drafter');
    expect(without.length).toBeGreaterThan(0);
    for (const call of without) expect(call.text).not.toContain('Do not describe a search');
  });

  it('carries the statement in a Layer 1 review written without the citation lock', async () => {
    citeByNumber = true;
    const report = await writeReview(STATEMENT, false);
    const closing = report.markdown.split(/^## About this report\s*$/m)[1] ?? '';
    expect(closing.trim().startsWith(STATEMENT)).toBe(true);
    expect(statesItsSearch(report.markdown)).toBe(true);
  });

  it('keeps the statement when a redraft of a review written without the lock rewords the closing note', async () => {
    citeByNumber = true;
    redraftRewordsClosingNote = true;
    const report = await writeReview(STATEMENT, false);
    // The redraft ran, and what it did to the report's own words was kept.
    expect(calls.some((call) => call.text.includes('Rewrite the report in plain encyclopedia prose'))).toBe(true);
    expect(report.markdown).not.toMatch(/\bverdict\b/i);
    const closing = report.markdown.split(/^## About this report\s*$/m)[1] ?? '';
    expect(closing.trim()).toBe(`${STATEMENT} 2 sources were read on ${formatReadDate()}.`);
  });

  it('holds every later version of a report to the closing note as code wrote it', () => {
    const body = '# A review\n\n## Summary\nInterleukin-6 fell [1].\n\n## References\n1. The Lancet.\n\n## About this report\n';
    const written = `${STATEMENT} 2 sources were read on 8 Oct 2026.`;
    const intact = `${body}${written}`;
    expect(closingNoteOf(intact)).toBe(written);
    expect(withClosingNoteRestored(intact, written)).toBe(intact);
    // Reworded, or cut down to the count.
    expect(withClosingNoteRestored(`${body}We searched several databases. 2 sources were read on 8 Oct 2026.`, written)).toBe(intact);
    expect(withClosingNoteRestored(`${body}2 sources were read on 8 Oct 2026.`, written)).toBe(intact);
    // Replaced by a statement that is false: the report still cites its sources.
    expect(withClosingNoteRestored(`${body}No sources were used.`, written)).toBe(intact);
    // The heading renamed or the section removed by a rewrite of the whole report: the note is put back at the end.
    const renamed = '# A review\n\n## Summary\nInterleukin-6 fell [1].\n\n## References\n1. The Lancet.\n\n## Methodology\nWe searched widely.\n';
    expect(withClosingNoteRestored(renamed, written)).toBe(`${renamed.trimEnd()}\n\n## About this report\n${written}`);
    const removed = '# A review\n\n## Summary\nInterleukin-6 fell [1].';
    expect(withClosingNoteRestored(removed, written).endsWith(`\n\n## About this report\n${written}`)).toBe(true);
    expect(statesItsSearch(withClosingNoteRestored(removed, written))).toBe(true);
    // A report that truly used no sources is held to that, and a run with no note to keep is left alone.
    expect(withClosingNoteRestored(`${body}Something else.`, 'No sources were used.')).toBe(`${body}No sources were used.`);
    expect(withClosingNoteRestored(`${body}Reworded by a repair.`, '')).toBe(`${body}Reworded by a repair.`);
    expect(closingNoteOf(removed)).toBe('');
  });

  it('keeps a section a repair appended after the closing note when it puts the note back', () => {
    const head = '# A review\n\n## Summary\nInterleukin-6 fell [1].\n\n## About this report\n';
    const written = `${STATEMENT} 2 sources were read on 8 Oct 2026.`;
    const appended = '## Discussion of patterns\nTwo cohorts agree on the direction of change [1].\n\n### A sub-heading\nMore detail.';
    const reworded = `${head}We looked in a few places. 2 sources were read on 8 Oct 2026.\n\n${appended}`;
    const restored = withClosingNoteRestored(reworded, written);
    expect(restored).toBe(`${head}${written}\n\n${appended}`);
    // Already in place, with a section after it: nothing changes.
    expect(withClosingNoteRestored(restored, written)).toBe(restored);
    expect(closingNoteOf(restored)).toBe(written);
    // The contract check is given the note itself, not whatever follows it.
    const long = `${head.replace('Interleukin-6 fell [1].', 'Interleukin-6 fell [1]. '.repeat(3000))}${written}\n\n${appended}`;
    const given = boundedReportForAudit(long, 60000, STATEMENT);
    expect(given.length).toBeLessThanOrEqual(60000);
    expect(given.endsWith(`## About this report\n${written}`)).toBe(true);
  });

  it('shows the contract check the closing note of a report longer than the check can be given', () => {
    const long = `# A review\n\n## Summary\n${'Interleukin-6 fell in patients who recovered [1]. '.repeat(1600)}\n\n## References\n1. The Lancet.\n\n## About this report\n${STATEMENT} 2 sources were read on 8 Oct 2026.`;
    expect(long.length).toBeGreaterThan(60000);
    // Cut at the limit, as the check was given it before, the statement is gone.
    expect(statesItsSearch(long.slice(0, 60000))).toBe(false);
    const given = boundedReportForAudit(long, 60000, STATEMENT);
    expect(given.length).toBeLessThanOrEqual(60000);
    expect(given.startsWith('# A review\n\n## Summary\nInterleukin-6 fell')).toBe(true);
    expect(given).toContain('[Part of the report is left out here for length.]');
    expect(given.endsWith(`## About this report\n${STATEMENT} 2 sources were read on 8 Oct 2026.`)).toBe(true);
    expect(statesItsSearch(given)).toBe(true);
    // A report inside the limit is given whole, and a run with no statement is cut exactly as before.
    expect(boundedReportForAudit('short report', 60000, STATEMENT)).toBe('short report');
    expect(boundedReportForAudit(long, 60000, '')).toBe(long.slice(0, 60000));
  });

  it('tells the checks where the statement is and that the writer did not write it', () => {
    const context = searchScopeGateContext(STATEMENT);
    expect(context).toContain('"About this report"');
    expect(context).toContain('what was searched and how sources were chosen');
    expect(context.endsWith('\n\n')).toBe(true);
  });

  it('is handed by the run to the writer, to both checks and to the save', () => {
    // The run itself cannot be driven in a unit test. This reads the one place
    // the note is made and every place it must arrive, so a statement that is
    // worked out and then handed to nothing fails here.
    const source = readFileSync(resolve(__dirname, '../services/reasoning/researchOrchestrator.ts'), 'utf8');
    expect(source).toContain('const searchScopeNote = searchScopeNoteFor({ layer1Run, intentId: orchProfile.intent, summaries: searchPasses });');
    expect(source.match(/searchPasses\.push\(/g)).toHaveLength(3);
    expect(source).toContain('lockedPassages, undefined, referenceStyle, searchScopeNote).markdown');
    expect(source).toContain('...(searchScopeNote ? { searchScopeNote } : {}),');
    expect(source).toContain('finalizeLockedReportForSave(generatedReport.markdown, researchQuery, lockedPassages, referenceStyle, undefined, searchScopeNote)');
    expect(source.match(/\$\{gateContext\}Verify this research report meets epistemic standards/g)).toHaveLength(2);
    expect(source).toContain('`${gateContext}RESEARCH_BRIEF:');
    // Without the lock the note is put back before the checks read the report and before it is saved,
    // and the contract check is given the closing note of a long report.
    expect(source).toContain('if (searchScopeNote && !lockedPassages) writtenClosingNote = closingNoteOf(generatedReport.markdown);');
    expect(source).toContain(': withClosingNoteRestored(markdown, writtenClosingNote);');
    expect(source).toContain('generatedReport.markdown = withClosingNoteRestored(checked.markdown, writtenClosingNote);');
    expect(source).toContain('${boundedReportForAudit(markdown, 60000, searchScopeNote)}');
  });
});
