/**
 * Tests for `deriveGeneratedReportTitle` and `looksLikeStructuralLabel`.
 *
 * WO-AE-3 acceptance: A structural label ("Dimensions Table", "Comparison Table",
 * "Recommendation") must never be accepted as a report title.
 * Rule 16: verify each test fails when the fix is absent by running with the
 * structural-label guard removed.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(),
  SYSTEM_PROMPTS: { outline_architect: 'outline', section_drafter: 'draft', internal_challenger: 'challenge', coherence_refiner: 'refine' },
  getSystemPrompt: () => 'mock',
  buildVerifierPromptForIntent: () => 'mock',
}));

import {
  deriveGeneratedReportTitle,
  isTableDelimiterRow,
  looksLikeMarkdownBlockSyntax,
  looksLikeStructuralLabel,
} from '../services/reasoning/reportGenerator';

describe('looksLikeStructuralLabel', () => {
  it.each([
    'Dimensions Table',
    'dimensions table',
    'DIMENSIONS TABLE',
    'Comparison Table',
    'Ranking Table',
    'Summary Table',
    'Data Table',
    'Recommendation',
    'Overview',
    'Introduction',
    'Findings',
    'Analysis',
    'Conclusion',
    'Results',
    'Executive Summary',
    'Methodology',
    'Background',
    'Appendix',
    'References',
    'Bibliography',
  ])('returns true for structural label: %s', (label) => {
    expect(looksLikeStructuralLabel(label)).toBe(true);
  });

  it.each([
    'Comparison of RNA-Sequencing Methods',
    'Overview of CRISPR-Cas9 Applications in Oncology',
    'Findings on Memory Consolidation During Sleep',
    'Dimensions of Climate Policy Trade-offs',
    'Recommendation Framework for Antibiotic Stewardship',
  ])('returns false for subject-specific title: %s', (title) => {
    expect(looksLikeStructuralLabel(title)).toBe(false);
  });
});

describe('deriveGeneratedReportTitle', () => {
  const query = 'compare rna sequencing methods';

  it('uses the first heading when it is a real subject', () => {
    const md = '# Comparison of RNA-Sequencing Methods\n\nContent here.';
    expect(deriveGeneratedReportTitle(query, md)).toBe('Comparison of RNA-Sequencing Methods');
  });

  it('rejects a structural label as the first heading and falls through to content', () => {
    const md = '# Dimensions Table\n\nRNA-seq is a powerful tool for transcriptome analysis.';
    const title = deriveGeneratedReportTitle(query, md);
    // Must not be "Dimensions Table"
    expect(title).not.toBe('Dimensions Table');
    // Should derive from body text instead
    expect(title.length).toBeGreaterThan(0);
  });

  it('rejects "Comparison Table" structural label', () => {
    const md = '# Comparison Table\n\nSome real content follows.';
    const title = deriveGeneratedReportTitle(query, md);
    expect(title).not.toBe('Comparison Table');
  });

  it('rejects "Recommendation" structural label', () => {
    const md = '# Recommendation\n\nAdopt next-generation sequencing.';
    const title = deriveGeneratedReportTitle(query, md);
    expect(title).not.toBe('Recommendation');
  });

  it('falls back to intent label when all headings and lines are structural', () => {
    const md = '# Overview\n\nFindings\n\nAnalysis';
    const title = deriveGeneratedReportTitle(query, md, 'comparative');
    // Structural labels should be filtered; fall back to intent title
    expect(title).toBeTruthy();
    expect(['Dimensions Table', 'Overview', 'Findings', 'Analysis']).not.toContain(title);
  });

  it('does not reject subject-specific titles that contain structural words', () => {
    const title = 'Overview of CRISPR-Cas9 Applications in Oncology';
    const md = `# ${title}\n\nContent here.`;
    expect(deriveGeneratedReportTitle(query, md)).toBe(title);
  });
});

/**
 * Codex, PR #224: rejecting the `# Dimensions Table` heading made the fallback
 * walk onto the table it introduced, so the header row became the title.
 */
describe('looksLikeMarkdownBlockSyntax', () => {
  it.each([
    '| Dimension | Option A | Option B |',
    '|---|---|---|',
    '| --- | :---: | ---: |',
    '--- | --- | ---',
    '---',
    '***',
    '___',
    '```',
    '```markdown',
    '~~~',
    '> Quoted line',
  ])('returns true for block syntax: %s', (line) => {
    expect(looksLikeMarkdownBlockSyntax(line)).toBe(true);
  });

  it.each([
    'Comparison of RNA-Sequencing Methods',
    'Cost-Benefit Analysis of Short-Read vs Long-Read Platforms',
    'Throughput | accuracy trade-offs in modern sequencers',
    'A-B testing outcomes',
  ])('returns false for prose: %s', (line) => {
    expect(looksLikeMarkdownBlockSyntax(line)).toBe(false);
  });
});

describe('isTableDelimiterRow', () => {
  it.each(['| --- | --- |', '|---|---|', '--- | --- | ---', '| :--- | ---: |', '| --- |'])(
    'returns true for delimiter row: %s',
    (line) => {
      expect(isTableDelimiterRow(line)).toBe(true);
    }
  );

  it('returns false for a setext heading underline, which has no pipe', () => {
    // `Some Real Title` followed by `---` is an H2, not a table.
    expect(isTableDelimiterRow('---')).toBe(false);
  });

  it.each(['Metric | Short-read', 'Long-read platforms resolve structural variants.', ''])(
    'returns false for: %s',
    (line) => {
      expect(isTableDelimiterRow(line)).toBe(false);
    }
  );
});

describe('deriveGeneratedReportTitle — markdown tables', () => {
  const query = 'compare rna sequencing methods';

  it('does not store a table header row as the title', () => {
    const md = [
      '# Dimensions Table',
      '',
      '| Dimension | Option A | Option B |',
      '| --- | --- | --- |',
      '| Cost | Low | High |',
      '',
      'Short-read sequencing remains the cheaper option at scale.',
    ].join('\n');

    const title = deriveGeneratedReportTitle(query, md, 'comparative');

    expect(title).toBe('Short-read sequencing remains the cheaper option at scale.');
  });

  it('skips a horizontal rule and a delimiter row to reach prose', () => {
    const md = [
      '# Overview',
      '',
      '---',
      '',
      'Metric | Short-read | Long-read',
      '--- | --- | ---',
      '',
      'Long-read platforms resolve structural variants that short reads miss.',
    ].join('\n');

    expect(deriveGeneratedReportTitle(query, md, 'comparative')).toBe(
      'Long-read platforms resolve structural variants that short reads miss.'
    );
  });

  it('falls back to the intent title when the report is nothing but a table', () => {
    const md = ['# Comparison Table', '', '| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');

    const title = deriveGeneratedReportTitle(query, md, 'comparative');

    expect(title).toBe('Comparative Report');
    expect(title).not.toContain('|');
  });
});
