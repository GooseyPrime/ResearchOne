/**
 * Slice 5, item 11: one presentation mapper for every reader-facing report
 * projection, and stored reader text is clean, not only shown clean.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanReaderMetadata, cleanSectionForStorage, presentForReader, presentSectionForReader, stripInternalLabelsFromReport } from '../services/formatting/reportPresentation';
import { forReader, notReportText } from '../api/readerResponse';
import * as configModule from '../config';
import { runWithFlags } from '../config';
import { RETIRED_FLAG_NAMES, isHarnessFlagName } from '../services/eval/harnessFlags';

const LABELLED = 'Costs rose sharply [established_fact] after 1979.';
const CLEAN = stripInternalLabelsFromReport(LABELLED);

describe('the fixture', () => {
  it('carries a label the clean-up removes', () => {
    expect(LABELLED).toContain('established_fact');
    expect(CLEAN).not.toContain('established_fact');
    expect(CLEAN).toContain('Costs rose sharply');
  });
});

describe('presentForReader', () => {
  it('cleans a report list row: title and summary', () => {
    const rows = presentForReader([{ id: 'r1', title: LABELLED, executive_summary: LABELLED, query: LABELLED, source_count: 3 }]);
    expect(rows[0].title).toBe(CLEAN);
    expect(rows[0].executive_summary).toBe(CLEAN);
    expect(rows[0].source_count).toBe(3);
  });

  it("never touches what a person typed: the question and their notes", () => {
    const row = presentForReader({ query: LABELLED, supplemental: LABELLED, revision_rationale: LABELLED, request_text: LABELLED });
    expect(row).toEqual({ query: LABELLED, supplemental: LABELLED, revision_rationale: LABELLED, request_text: LABELLED });
  });

  it("leaves a title alone where the title is not the report's: a run's is the question, a source's is the publisher's", () => {
    const run = presentForReader({ title: LABELLED, display_title: LABELLED, sources: [{ title: LABELLED }] }, { title: 'not-report' });
    expect(run).toEqual({ title: LABELLED, display_title: CLEAN, sources: [{ title: LABELLED }] });
  });

  it("in a response that mixes the two, cleans the title of the report it holds and no other", () => {
    const dossier = presentForReader(
      { request: { title: LABELLED }, report: { reportId: 'r1', title: LABELLED }, sources: [{ title: LABELLED }], displayTitle: LABELLED },
      { title: 'not-report', reportTitleUnder: ['report'] }
    );
    expect(dossier).toEqual({ request: { title: LABELLED }, report: { reportId: 'r1', title: CLEAN }, sources: [{ title: LABELLED }], displayTitle: CLEAN });
  });

  it('cleans the lists a report shows as written: open questions and suggested searches', () => {
    const report = presentForReader({ unresolved_questions: [LABELLED], recommended_queries: [LABELLED, 'plain'] });
    expect(report).toEqual({ unresolved_questions: [CLEAN], recommended_queries: [CLEAN, 'plain'] });
  });

  it('cleans a full report: sections, summary fields and the reader metadata', () => {
    const report = presentForReader({
      title: LABELLED,
      conclusion: LABELLED,
      falsification_criteria: LABELLED,
      sections: [{ id: 's1', title: LABELLED, content: LABELLED, section_order: 0 }],
      metadata: {
        plain_language_markdown: LABELLED,
        reader_front_matter: { overall_summary: LABELLED, conclusions_nutshell: LABELLED, metric_glosses: [{ label: LABELLED, gloss: LABELLED }] },
        model_log: [{ model: 'x/y', note: LABELLED }],
      },
    });
    expect(report.conclusion).toBe(CLEAN);
    expect(report.falsification_criteria).toBe(CLEAN);
    expect(report.sections[0]).toEqual({ id: 's1', title: CLEAN, content: CLEAN, section_order: 0 });
    expect(report.metadata.plain_language_markdown).toBe(CLEAN);
    expect(report.metadata.reader_front_matter).toEqual({ overall_summary: CLEAN, conclusions_nutshell: CLEAN, metric_glosses: [{ label: CLEAN, gloss: CLEAN }] });
    // Not a reader field: left as stored.
    expect(report.metadata.model_log[0].note).toBe(LABELLED);
  });

  it('cleans dossier cards, history rows, revisions and a spinoff prefill', () => {
    expect(presentForReader({ items: [{ run_display_title: LABELLED, display_title: LABELLED }] }).items[0]).toEqual({ run_display_title: CLEAN, display_title: CLEAN });
    expect(presentForReader({ reportTitle: LABELLED, query: LABELLED })).toEqual({ reportTitle: CLEAN, query: LABELLED });
    const revision = presentForReader({ sections: [{ section_title: LABELLED, before_content: LABELLED, after_content: LABELLED }], diffs: [{ section_title: LABELLED }] });
    expect(revision.sections[0]).toEqual({ section_title: CLEAN, before_content: CLEAN, after_content: CLEAN });
    expect(revision.diffs[0].section_title).toBe(CLEAN);
  });

  it('returns a copy and leaves dates, numbers, nulls and the stored row alone', () => {
    const when = new Date('2026-10-07T00:00:00Z');
    const stored = { title: LABELLED, created_at: when, version_number: 2, parent_report_id: null, tags: ['a'] };
    const shown = presentForReader(stored);
    expect(stored.title).toBe(LABELLED);
    expect(shown.created_at).toBe(when);
    expect(shown).toMatchObject({ version_number: 2, parent_report_id: null, tags: ['a'] });
    expect(presentForReader(null)).toBeNull();
    expect(presentForReader('plain')).toBe('plain');
  });
});

describe('a response is always sent clean: there is no setting that sends report text as stored', () => {
  it("forReader is the mapper, with READER_VIEW_ENABLED unset, 'false' or recorded off for the run", () => {
    const rows = [{ title: LABELLED }];
    const was = process.env.READER_VIEW_ENABLED;
    try {
      delete process.env.READER_VIEW_ENABLED;
      expect(forReader(rows)).toEqual([{ title: CLEAN }]);
      process.env.READER_VIEW_ENABLED = 'false';
      expect(forReader(rows)).toEqual([{ title: CLEAN }]);
      expect(runWithFlags({ READER_VIEW_ENABLED: false }, () => forReader(rows))).toEqual([{ title: CLEAN }]);
    } finally {
      if (was === undefined) delete process.env.READER_VIEW_ENABLED;
      else process.env.READER_VIEW_ENABLED = was;
    }
    // A cleaned copy: the stored row is not the response and is not changed.
    expect(forReader(rows)).not.toBe(rows);
    expect(rows[0].title).toBe(LABELLED);
    expect(forReader(rows, { title: 'not-report' })).toEqual(rows);
    expect(notReportText(rows)).toBe(rows);
  });

  it('report detail and revision detail keep the clean-up they had before this slice', () => {
    const source = readFileSync(join(__dirname, '../api/routes/reports.ts'), 'utf8');
    expect(source).toContain('metadata: cleanReaderMetadata(stored.metadata),');
    expect(source).toContain('res.json(forReader(cleanRevisionForReader(revision)));');
  });
});

describe('every route that returns report text to a reader goes through the mapper', () => {
  it.each(['reports.ts', 'dossiers.ts'])('%s: every successful response is either mapped or marked as carrying no report text', (file) => {
    const source = readFileSync(join(__dirname, '../api/routes', file), 'utf8');
    // Every way a handler sends a body: res.json(…), res.status(n).json(…), with any expression for n.
    const sent = [...source.matchAll(/res(\.status\(([^)]*)\))?\.json\(([\s\S]{0,30})/g)].map((match) => ({ status: match[2], argument: match[3] }));
    expect(sent.length).toBeGreaterThan(8);
    const successful = sent.filter((response) => response.status === undefined || /^20\d$/.test(response.status.trim()));
    expect(successful.length).toBeGreaterThan(8);
    expect(successful.filter((response) => !/^(forReader|notReportText)\(/.test(response.argument)).map((response) => response.argument)).toEqual([]);
    // What is left is an error: a literal status of 400 or above, or one computed between two error codes.
    for (const response of sent.filter((response) => !successful.includes(response))) {
      expect(response.status).toMatch(/^\s*(4\d\d|5\d\d)\s*$|\? 504 : 422/);
    }
  });

  it("a title is cleaned where it is a report's and left alone where it is a question's or a source's", () => {
    const dossiers = readFileSync(join(__dirname, '../api/routes/dossiers.ts'), 'utf8');
    // The report link and the report history hold report titles.
    expect(dossiers).toContain('res.json(forReader(link));');
    expect(dossiers).toContain('res.json(forReader(history));');
    // The whole dossier holds a report beside a request.
    expect(dossiers).toContain("res.json(forReader(dossier, { title: 'not-report', reportTitleUnder: ['report'] }));");
    // Sources carry the publisher's title.
    expect(dossiers).toContain("res.json(forReader(sources, { title: 'not-report' }));");
    const runs = readFileSync(join(__dirname, '../api/routes/research.ts'), 'utf8');
    expect(runs).toContain("res.json(forReader(rows, { title: 'not-report' }));");
    expect(runs).toContain("res.json(forReader(rows[0], { title: 'not-report' }));");
    expect(readFileSync(join(__dirname, '../api/routes/reports.ts'), 'utf8')).toContain("res.json(forReader(citations, { title: 'not-report' }));");
  });
});

describe('a revision is always stored clean', () => {
  it('cleans a revised section before it is written', () => {
    expect(cleanSectionForStorage({ id: 's1', title: LABELLED, content: LABELLED, section_order: 1 })).toEqual({ id: 's1', title: CLEAN, content: CLEAN, section_order: 1 });
  });

  it('is what the revision save path writes: the report row, its sections, and both sides of the kept history', () => {
    const source = readFileSync(join(__dirname, '../services/reasoning/reportRevisionService.ts'), 'utf8');
    expect(source).toContain('const asStored = (text: string): string => stripInternalLabelsFromReport(text);');
    expect(source).toContain('const sectionsToStore = revisedSections.map(cleanSectionForStorage);');
    // Nothing decides per run whether to clean.
    expect(source).not.toMatch(/storeClean\b|storeCleanForRun|readerViewForRun|readerViewEnabled/);
    expect(source).toContain('asStored(baseReport.title),');
    // Every insert of section text reads the stored copy; none reads the revised sections directly.
    const inserts = source.slice(source.indexOf('const sectionsToStore'));
    expect(inserts.match(/for \(const (\[at, section\]|section) of sectionsToStore/g)).toHaveLength(2);
    expect(inserts).not.toMatch(/for \(const section of revisedSections\)/);
    expect(inserts.match(/^ {10}beforeContent,$/gm)).toHaveLength(2);
    expect(inserts).not.toContain("before?.content ?? '',");
  });

  it('a spinoff is always given the earlier report clean', () => {
    const source = readFileSync(join(__dirname, '../services/research/spinoffService.ts'), 'utf8');
    expect(source).toContain('const clean = (text: string): string => stripInternalLabelsFromReport(text);');
    expect(source).not.toContain('readerViewEnabled');
    expect(source).toContain("parts.push(clean(sec.content ?? ''));");
  });
});

describe('the reader view is not switched', () => {
  it('has no READER_VIEW_ENABLED to read, for the process or for one run', () => {
    expect('readerViewEnabled' in configModule).toBe(false);
    expect(isHarnessFlagName('READER_VIEW_ENABLED')).toBe(false);
    expect(RETIRED_FLAG_NAMES).toEqual(['BASELINE_LAYER_ENABLED', 'CITATION_LOCK_ENABLED', 'READER_VIEW_ENABLED']);
    expect(readFileSync(join(__dirname, '../services/eval/readerView.ts'), 'utf8')).not.toMatch(/function readerViewForRun|readerViewEnabled\(/);
  });

  it('every report is sent as a reader-view report, its sections under the headings a reader sees', () => {
    const source = readFileSync(join(__dirname, '../api/routes/reports.ts'), 'utf8');
    expect(source).toContain('reader_view: true }));');
    expect(source).not.toContain('readerViewForRun');
    expect(source).toContain('const sections = storedSections.map(presentSectionForReader);');
    expect(source).toContain('falsification_criteria: null,');
  });
});

describe('a section of a report saved in the removed layout, as a reader is sent it', () => {
  it.each([
    ['Framing', 'Background'],
    ['Primary Evidence', 'What the sources show'],
    ['Evidence Ledger', 'What the sources show'],
    ['Contested Zones', 'Where sources disagree'],
    ['Contradiction Analysis', 'Where sources disagree'],
    ['Unresolved', 'Open questions'],
    ['Unresolved Questions', 'Open questions'],
    ['Executive Summary', 'Summary'],
    ['Research Question and Scope', 'What was asked'],
    ['Recommended Next Queries', 'Further questions'],
  ])('shows "%s" as "%s", without the labels and without the heading repeated in the text', (stored, shown) => {
    const section = presentSectionForReader({ id: 's1', title: stored, content: `${stored}\n\n${LABELLED}`, section_order: 2, section_type: 'analysis' });
    expect(section).toEqual({ id: 's1', title: shown, content: CLEAN, section_order: 2, section_type: 'analysis' });
  });

  it.each([
    ['Challenges and Alternative Explanations', 'Other explanations'],
    ['Falsification Criteria', 'What would change these findings'],
  ])('marks "%s" as challenge material under "%s"', (stored, shown) => {
    expect(presentSectionForReader({ title: stored, content: LABELLED, section_type: 'analysis' })).toEqual({ title: shown, content: CLEAN, section_type: 'challenge' });
  });

  it('leaves a heading of the plain report as written, and returns a copy', () => {
    const stored = { title: 'How the costs grew', content: LABELLED, section_type: 'analysis' };
    expect(presentSectionForReader(stored)).toEqual({ title: 'How the costs grew', content: CLEAN, section_type: 'analysis' });
    expect(stored.content).toBe(LABELLED);
  });

  it('takes the sentences the old layout wrote about its own machinery out of the text', () => {
    const text = [
      'This report synthesizes evidence from 14 sources and 96 evidence chunks. Costs doubled.',
      'The current evidence set does not surface explicit contradiction pairs, but conclusions remain conditional on corpus coverage. Two audits differ.',
      'The findings include 3 explicit contradiction points. The baseline is disputed.',
    ].join('\n');
    expect(stripInternalLabelsFromReport(text)).toBe('Costs doubled.\nTwo audits differ.\nThe baseline is disputed.');
  });

  it('sends no metric glosses and maps a revision heading to the one a reader sees', () => {
    expect(cleanReaderMetadata({ reader_front_matter: { overall_summary: LABELLED, metric_glosses: [{ label: 'x', gloss: 'y' }] } }).reader_front_matter).toMatchObject({ overall_summary: CLEAN, metric_glosses: [] });
    expect(presentForReader({ diffs: [{ section_title: 'Contested Zones' }] }).diffs[0].section_title).toBe('Where sources disagree');
  });
});
