/**
 * RJ-018 item 2. Old reports printed a grade together with where it came from
 * after a sentence: "(established_fact, Chunk 17)", "(inference, Challenger
 * Findings)". The clean-up removed a grade standing alone and left these, or
 * took the grade and left "(, Chunk 17)". These tests hold the formatter that
 * removes exactly those label shapes and leaves every ordinary parenthesis.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  presentForReader,
  presentSectionForReader,
  readerFacingLabelHits,
  stripInternalLabelsFromReport,
} from '../services/formatting/reportPresentation';

interface LabelCase {
  name: string;
  input: string;
  report: string;
  preview: string;
}
const CASES = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'reportLabelCases.json'), 'utf8')) as { labels: LabelCase[]; kept: string[] };

describe('labels inside old report text', () => {
  it.each(CASES.labels.map((entry) => [entry.name, entry] as const))('%s is removed', (_name, entry) => {
    expect(stripInternalLabelsFromReport(entry.input)).toBe(entry.report);
  });

  it('none of the labels Brandon was shown survives, in any of the shapes it was printed in', () => {
    const shown = [
      '(established_fact, Chunk 17)',
      '(strong_evidence, Chunks 2, 12, 15)',
      '(inference, Challenger Findings)',
      '(speculation, Critical Notes)',
      '(preserved contradiction, Reasoning Output)',
    ];
    for (const label of shown) {
      const cleaned = stripInternalLabelsFromReport(`The council voted in May ${label}. A second vote followed.`);
      expect(cleaned, label).not.toMatch(/established_fact|strong_evidence|inference|speculation|preserved contradiction|Challenger|Critical Notes|Reasoning Output/i);
      // Nothing is left where the label stood: no empty or half-empty bracket.
      expect(cleaned, label).not.toMatch(/\(\s*[,;]?\s*\)|\(\s*,|\s+\./);
      expect(cleaned.endsWith('A second vote followed.'), label).toBe(true);
    }
  });

  it.each(CASES.kept)('keeps an ordinary parenthesis: %s', (sentence) => {
    expect(stripInternalLabelsFromReport(sentence)).toBe(sentence);
  });

  it('keeps the passage numbers of a label, which are the citations of an old report', () => {
    expect(stripInternalLabelsFromReport('It rained (strong_evidence, Chunks 2, 12 and 15).')).toBe('It rained [Chunks 2, 12, 15].');
    expect(stripInternalLabelsFromReport('It rained (established_fact, Chunk 4; Chunk 9).')).toBe('It rained [Chunks 4, 9].');
  });

  it('does not touch a label written inside code or a link', () => {
    const code = 'Use `(established_fact, Chunk 17)` as the marker.';
    expect(stripInternalLabelsFromReport(code)).toBe(code);
  });

  it('the check that reads a finished report finds these labels', () => {
    expect(readerFacingLabelHits('Turnout rose (established_fact, Chunk 17).')).toContain('grade label');
    expect(readerFacingLabelHits('It was deliberate (inference, Challenger Findings).')).toContain('grade label');
    expect(readerFacingLabelHits('No second source (Challenger Findings).')).toContain('internal step');
    expect(readerFacingLabelHits('The bridge (opened in 1932) carries four lanes.')).toEqual([]);
  });
});

describe('every way old report text reaches a customer', () => {
  const OLD = 'Turnout rose (established_fact, Chunk 17). It may repeat (speculation, Critical Notes). See Recommended Next Queries.';
  const CLEAN_WORDS = /established_fact|speculation|Critical Notes|Recommended Next Queries/;

  it('a report section', () => {
    const section = presentSectionForReader({ title: 'Primary Evidence', content: OLD, section_order: 2 });
    expect(section.title).toBe('What the sources show');
    expect(section.content).not.toMatch(CLEAN_WORDS);
    expect(section.content).toContain('Further questions');
  });

  it('a report, its summary and its plain-language version', () => {
    const report = presentForReader({ title: 'Election turnout in 2024', executive_summary: OLD, metadata: { plain_language_markdown: OLD } });
    expect(report.executive_summary).not.toMatch(CLEAN_WORDS);
    expect(report.metadata.plain_language_markdown).not.toMatch(CLEAN_WORDS);
  });

  it('a dossier card and the Evidence tab', () => {
    const card = presentForReader({ rows: [{ reportTitle: 'Turnout (strong_evidence, Chunks 2, 12, 15)', displayTitle: 'Turnout (inference, Challenger Findings)', requestQuery: 'What happened to turnout?' }] }, { title: 'not-report' });
    expect(card.rows[0].reportTitle).toBe('Turnout [Chunks 2, 12, 15]');
    expect(card.rows[0].displayTitle).toBe('Turnout');
    const evidence = presentForReader({ findings: [{ content: OLD }] }, { title: 'not-report' });
    expect(evidence.findings[0].content).not.toMatch(CLEAN_WORDS);
  });
});
