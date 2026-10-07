/**
 * Slice 5, item 11: one presentation mapper for every reader-facing report
 * projection, and stored reader text is clean, not only shown clean.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanSectionForStorage, presentForReader, stripInternalLabelsFromReport } from '../services/formatting/reportPresentation';
import { readerViewEnabled, runWithFlags } from '../config';

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

describe('every route that returns report text to a reader goes through the mapper', () => {
  /** Responses that carry no report text: an acknowledgement or the export engine's state. */
  const NOT_REPORT_TEXT = /^\{\s*(ok: true|available: )/;

  it.each(['reports.ts', 'dossiers.ts'])('%s', (file) => {
    const source = readFileSync(join(__dirname, '../api/routes', file), 'utf8');
    const sent = [...source.matchAll(/res\.json\(([\s\S]{0,40})/g)].map((match) => match[1]);
    expect(sent.length).toBeGreaterThan(5);
    const bypassing = sent.filter((argument) => !argument.startsWith('presentForReader(') && !NOT_REPORT_TEXT.test(argument));
    expect(bypassing).toEqual([]);
  });
});

describe('other places a report title or its text is handed on', () => {
  it('the run list and run detail go through the mapper', () => {
    const source = readFileSync(join(__dirname, '../api/routes/research.ts'), 'utf8');
    expect(source).toContain('res.json(presentForReader(rows));');
    expect(source).toContain('res.json(presentForReader(rows[0]));');
  });

  it('a spinoff is given the earlier report clean', () => {
    const source = readFileSync(join(__dirname, '../services/research/spinoffService.ts'), 'utf8');
    expect(source).toContain("parts.push(stripInternalLabelsFromReport(sec.content ?? ''));");
    expect(source).toContain('report "${stripInternalLabelsFromReport(title)}"]');
  });
});

describe('a revision is stored clean', () => {
  it('cleans a revised section before it is written', () => {
    expect(cleanSectionForStorage({ id: 's1', title: LABELLED, content: LABELLED, section_order: 1 })).toEqual({ id: 's1', title: CLEAN, content: CLEAN, section_order: 1 });
  });

  it('is what the revision save path writes', () => {
    const source = readFileSync(join(__dirname, '../services/reasoning/reportRevisionService.ts'), 'utf8');
    expect(source).toContain('const section = cleanSectionForStorage(revised);');
    expect(source).toContain('stripInternalLabelsFromReport(baseReport.title),');
    expect(source).toMatch(/stripInternalLabelsFromReport\(\s*revisedSections\.find\(\(s\) => s\.section_type === 'falsification_criteria'\)/);
  });
});

describe('READER_VIEW_ENABLED', () => {
  it('is off unless set, and travels with the report', () => {
    expect(readerViewEnabled()).toBe(false);
    expect(runWithFlags({ READER_VIEW_ENABLED: true }, () => readerViewEnabled())).toBe(true);
    const source = readFileSync(join(__dirname, '../api/routes/reports.ts'), 'utf8');
    expect(source).toContain('reader_view: readerViewEnabled()');
  });
});
