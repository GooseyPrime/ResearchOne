/**
 * Slice 5, item 11: one presentation mapper for every reader-facing report
 * projection, and stored reader text is clean, not only shown clean.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanSectionForStorage, presentForReader, stripInternalLabelsFromReport } from '../services/formatting/reportPresentation';
import { forReader, notReportText } from '../api/readerResponse';
import { readerViewEnabled, runWithFlags } from '../config';
import { isHarnessFlagName } from '../services/eval/harnessFlags';

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

describe('S1: with the switch off a response is sent exactly as before', () => {
  it('forReader is the mapper with the switch on and nothing with it off', () => {
    const rows = [{ title: LABELLED }];
    expect(forReader(rows)).toBe(rows);
    expect(runWithFlags({ READER_VIEW_ENABLED: true }, () => forReader(rows))).toEqual([{ title: CLEAN }]);
    expect(runWithFlags({ READER_VIEW_ENABLED: true }, () => forReader(rows, { title: 'not-report' }))).toEqual(rows);
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

  it('the dossier routes, the run list and run detail, and the citation list leave a title that is not the report\'s alone', () => {
    const dossiers = readFileSync(join(__dirname, '../api/routes/dossiers.ts'), 'utf8');
    expect(dossiers.match(/forReader\(/g)).toHaveLength(dossiers.match(/forReader\([a-z]+, \{ title: 'not-report' \}\)/g)?.length ?? -1);
    const runs = readFileSync(join(__dirname, '../api/routes/research.ts'), 'utf8');
    expect(runs).toContain("res.json(forReader(rows, { title: 'not-report' }));");
    expect(runs).toContain("res.json(forReader(rows[0], { title: 'not-report' }));");
    expect(readFileSync(join(__dirname, '../api/routes/reports.ts'), 'utf8')).toContain("res.json(forReader(citations, { title: 'not-report' }));");
  });
});

describe('a revision is stored clean when the switch is on, and as before when it is off', () => {
  it('cleans a revised section before it is written', () => {
    expect(cleanSectionForStorage({ id: 's1', title: LABELLED, content: LABELLED, section_order: 1 })).toEqual({ id: 's1', title: CLEAN, content: CLEAN, section_order: 1 });
  });

  it('is what the revision save path writes: the report row, its sections, and both sides of the kept history', () => {
    const source = readFileSync(join(__dirname, '../services/reasoning/reportRevisionService.ts'), 'utf8');
    expect(source).toContain('const storeClean = readerViewEnabled();');
    expect(source).toContain('const sectionsToStore = storeClean ? revisedSections.map(cleanSectionForStorage) : revisedSections;');
    expect(source).toContain('asStored(baseReport.title),');
    // Every insert of section text reads the stored copy; none reads the revised sections directly.
    const inserts = source.slice(source.indexOf('const sectionsToStore'));
    expect(inserts.match(/for \(const (\[at, section\]|section) of sectionsToStore/g)).toHaveLength(2);
    expect(inserts).not.toMatch(/for \(const section of revisedSections\)/);
    expect(inserts.match(/^ {10}beforeContent,$/gm)).toHaveLength(2);
    expect(inserts).not.toContain("before?.content ?? '',");
  });

  it('a spinoff is given the earlier report clean under the same switch', () => {
    const source = readFileSync(join(__dirname, '../services/research/spinoffService.ts'), 'utf8');
    expect(source).toContain('const clean = (text: string): string => (readerViewEnabled() ? stripInternalLabelsFromReport(text) : text);');
    expect(source).toContain("parts.push(clean(sec.content ?? ''));");
  });
});

describe('READER_VIEW_ENABLED', () => {
  it('is off unless set, and can be set for one run like the other switches', () => {
    expect(readerViewEnabled()).toBe(false);
    expect(runWithFlags({ READER_VIEW_ENABLED: true }, () => readerViewEnabled())).toBe(true);
    expect(isHarnessFlagName('READER_VIEW_ENABLED')).toBe(true);
  });

  it("travels with the report, read as the report's own run recorded it", () => {
    const source = readFileSync(join(__dirname, '../api/routes/reports.ts'), 'utf8');
    expect(source).toContain('reader_view: await readerViewForRun(stored.run_id)');
    expect(source).toContain('return runWithFlags(await loadRunFlags(runId), () => readerViewEnabled());');
  });
});
