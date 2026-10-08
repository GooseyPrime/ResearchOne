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

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(async (options: { role: string; messages: Array<{ role: string; content: string }> }) => {
    const text = options.messages.map((message) => message.content).join('\n');
    const last = options.messages[options.messages.length - 1].content;
    calls.push({ role: options.role, text });
    const reply = (written: string) => ({ content: citeByNumber ? written.replace(/\[P(\d)\]/g, '[$1]') : written, model: 'test', role: options.role, promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' });
    if (options.role === 'outline_architect') {
      return reply('{"title":"Biomarkers of recovery from long COVID","outline":["Inflammatory markers","Markers of immune recovery"]}');
    }
    if (options.role !== 'section_drafter') return reply(last);
    if (text.includes('Section to draft: Summary')) return reply('Studies link falling interleukin-6 to recovery [P1].');
    if (text.includes('Section to draft: Key findings')) return reply('- Interleukin-6 fell in patients who recovered [P1].\n- T cell counts returned to normal within a year [P2].');
    if (text.includes('Section to draft: Where sources disagree')) return reply('The sources do not disagree.');
    if (text.includes('Section to draft: Limits of this report')) return reply('Both studies followed patients for one year only.');
    if (text.includes('Section to draft: Inflammatory markers')) return reply('Interleukin-6 was measured at three and twelve months [P1].');
    return reply('T cell counts were followed for twelve months [P2].');
  }),
  getSystemPrompt: () => 'Write the section.',
}));

import { generateIterativeReport, finalizeLockedReportForSave, stripInternalLabelsFromReport, stripPromptEchoFromReport } from '../services/reasoning/reportGenerator';
import { finalizeLockedCitations, issuePassages, type LockedPassage } from '../services/reasoning/citationLock';
import { presentationFailures } from '../services/reasoning/baselineReport';
import {
  describeSearchScope,
  mergeSearchRecords,
  reportStatesSearchScope,
  searchScopeGateContext,
  searchScopeNoteFor,
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

/** What discovery records for a run: the queries it ran and the results it kept or set aside. */
const FIRST_PASS = {
  queriesExecuted: ['long COVID biomarkers recovery', 'interleukin-6 long COVID cohort', 'long COVID biomarkers recovery'],
  candidatesFound: 14,
  candidatesSelected: 6,
  sources: [{ provider: 'tavily' }, { provider: 'openalex' }, { provider: 'pmc' }, { provider: 'brave' }],
};
const SECOND_PASS = {
  queriesExecuted: ['T cell recovery long COVID'],
  candidatesFound: 4,
  candidatesSelected: 2,
  sources: [{ provider: 'crossref' }],
};
const STATEMENT =
  'The search covered the open web, OpenAlex, PubMed Central and Crossref with 3 queries: “long COVID biomarkers recovery”; “interleukin-6 long COVID cohort”; “T cell recovery long COVID”. It returned 18 results on the subject, of which 8 were chosen to be read for their bearing on the question.';

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
    expect(record.queries).toEqual(['long COVID biomarkers recovery', 'interleukin-6 long COVID cohort', 'T cell recovery long COVID']);
    expect(record.providers).toEqual(['tavily', 'openalex', 'pmc', 'brave', 'crossref']);
    expect(record.found).toBe(18);
    expect(record.selected).toBe(8);
    expect(describeSearchScope(record)).toBe(STATEMENT);
    expect(searchScopeNoteFor({ layer1Run: true, intentId: 'literature_review', summaries: [FIRST_PASS, SECOND_PASS] })).toBe(STATEMENT);
    expect(presentationFailures(STATEMENT)).toEqual([]);
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
      found: 0,
      selected: 0,
    });
    expect(note).toBe('The search ran with 5 queries, among them “long COVID markers recovery”; “long COVID recovery time”.');
    expect(presentationFailures(note)).toEqual([]);
    // No more than five are listed, however many ran.
    const many = describeSearchScope({ queries: Array.from({ length: 9 }, (_, n) => `long COVID study ${n + 1}`), providers: ['arxiv'], found: 3, selected: 5 });
    expect(many.match(/“/g)).toHaveLength(5);
    expect(many.startsWith('The search covered arXiv with 9 queries, among them ')).toBe(true);
    // Counts that cannot both be true are left out.
    expect(many).not.toContain('It returned');
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
  });
});
