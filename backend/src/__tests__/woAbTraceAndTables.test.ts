import { describe, it, expect } from 'vitest';

import {
  TRACE_MESSAGE_MAX_CHARS,
  retrievalProgressLabel,
  truncateForTrace,
} from '../services/reasoning/traceDisplay';
import {
  checkTableContract,
  extractMarkdownTables,
  resolveTableExpectation,
} from '../services/reasoning/tableContract';

/**
 * WO-AB — live-trace flooding and table contract.
 *
 * Reference symptom: the run trace showed the user's entire ~700-line research
 * prompt, five times in succession, because the retrieval progress message
 * interpolated the raw retrieval query (planners put the whole prompt there).
 */

const HUGE_QUERY = `# Research Objective: Identify and Rank the 20 Best Affiliate Comparison-Site Opportunities

Conduct a sourced Opportunity Discovery study.
${'Additional requirement line that goes on and on. '.repeat(400)}`;

describe('trace display — flooding guard', () => {
  it('collapses a multi-thousand-character query to a scannable line', () => {
    const out = truncateForTrace(HUGE_QUERY, TRACE_MESSAGE_MAX_CHARS);
    expect(out.length).toBeLessThanOrEqual(TRACE_MESSAGE_MAX_CHARS);
    expect(out).toContain('…');
  });

  it('flattens newlines so a message cannot render as a wall of text', () => {
    const out = truncateForTrace('line one\n\nline two\n\tline three', 200);
    expect(out).toBe('line one line two line three');
    expect(out).not.toContain('\n');
  });

  it('leaves short messages untouched', () => {
    expect(truncateForTrace('Retrieving evidence from corpus...', 200)).toBe(
      'Retrieving evidence from corpus...'
    );
  });

  it('labels retrieval passes by counter instead of echoing the query', () => {
    const label = retrievalProgressLabel({ index: 3, total: 5, chunkCount: 14 });
    expect(label).toBe('Retrieval 3/5 complete — 14 chunks so far');
    expect(label).not.toContain('Research Objective');
    expect(label.length).toBeLessThan(TRACE_MESSAGE_MAX_CHARS);
  });

  it('singularises a one-chunk result', () => {
    expect(retrievalProgressLabel({ index: 1, total: 1, chunkCount: 1 })).toContain('1 chunk so far');
  });

  it('marks the re-discovery pass distinctly', () => {
    expect(
      retrievalProgressLabel({ index: 2, total: 4, chunkCount: 0, pass: 'rediscovery' })
    ).toContain('(re-discovery)');
  });
});

describe('table contract — deterministic checks', () => {
  const goodTable = [
    '| Rank | Vertical | Score |',
    '| --- | --- | --- |',
    '| 1 | Web hosting | 82 |',
    '| 2 | Email marketing | 79 |',
  ].join('\n');

  it('extracts headers and rows from a GFM table', () => {
    const tables = extractMarkdownTables(`Intro text\n\n${goodTable}\n\nOutro`);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.headers).toEqual(['Rank', 'Vertical', 'Score']);
    expect(tables[0]?.rows).toHaveLength(2);
  });

  it('does not require a table when the user never asked for one', () => {
    const expectation = resolveTableExpectation({
      requestedArtifacts: [{ type: 'summary', description: 'a short narrative' }],
      userConstraints: [],
    });
    expect(expectation.required).toBe(false);
    expect(checkTableContract('No tables here at all.', expectation)).toEqual([]);
  });

  it('requires a table when the brief asks for one', () => {
    const expectation = resolveTableExpectation({
      requestedArtifacts: [
        { type: 'table', description: 'master portfolio table', exactCount: 20 },
      ],
      userConstraints: [],
    });
    expect(expectation.required).toBe(true);
    const issues = checkTableContract('No tables here at all.', expectation);
    expect(issues.map((i) => i.code)).toContain('table_missing');
  });

  it('flags a row-count mismatch against the requested item count', () => {
    const expectation = resolveTableExpectation(
      { requestedArtifacts: [{ type: 'table', description: 'portfolio table' }], userConstraints: [] },
      20
    );
    const issues = checkTableContract(goodTable, expectation);
    expect(issues.map((i) => i.code)).toContain('table_row_count');
    expect(issues.find((i) => i.code === 'table_row_count')?.message).toContain('2 data rows');
  });

  it('flags missing required columns', () => {
    const expectation = resolveTableExpectation({
      requestedArtifacts: [
        {
          type: 'table',
          description: 'portfolio table',
          exactCount: 2,
          explicitRequiredFields: ['Rank', 'Vertical', 'Recurring commission potential'],
        },
      ],
      userConstraints: [],
    });
    const issues = checkTableContract(goodTable, expectation);
    expect(issues.map((i) => i.code)).toContain('table_columns_missing');
    expect(issues.find((i) => i.code === 'table_columns_missing')?.message).toContain(
      'Recurring commission potential'
    );
  });

  it('passes a well-formed table that meets the contract', () => {
    const expectation = resolveTableExpectation({
      requestedArtifacts: [
        {
          type: 'table',
          description: 'portfolio table',
          exactCount: 2,
          explicitRequiredFields: ['Rank', 'Vertical', 'Score'],
        },
      ],
      userConstraints: [],
    });
    expect(checkTableContract(goodTable, expectation)).toEqual([]);
  });

  it('flags rows whose cell count does not match the header', () => {
    const malformed = [
      '| Rank | Vertical | Score |',
      '| --- | --- | --- |',
      '| 1 | Web hosting |',
      '| 2 | Email marketing | 79 |',
    ].join('\n');
    const expectation = resolveTableExpectation({
      requestedArtifacts: [{ type: 'table', description: 'portfolio table', exactCount: 2 }],
      userConstraints: [],
    });
    const issues = checkTableContract(malformed, expectation);
    expect(issues.map((i) => i.code)).toContain('table_malformed');
  });

  it('picks the best-matching table when the report contains several', () => {
    const unrelated = ['| A | B |', '| --- | --- |', '| x | y |'].join('\n');
    const expectation = resolveTableExpectation({
      requestedArtifacts: [
        {
          type: 'table',
          description: 'portfolio table',
          exactCount: 2,
          explicitRequiredFields: ['Rank', 'Vertical', 'Score'],
        },
      ],
      userConstraints: [],
    });
    // The unrelated 1-row table must not mask the compliant portfolio table.
    expect(checkTableContract(`${unrelated}\n\n${goodTable}`, expectation)).toEqual([]);
  });

  it('ignores tables inside fenced code blocks', () => {
    // Copilot + Codex, PR #204: a table *example* in a code fence renders as
    // code, not a table. Accepting it would let a report satisfy a table
    // requirement it never delivered — a check bypassable by fencing is worse
    // than no check.
    const fenced = [
      'Here is the format to use:',
      '',
      '```markdown',
      '| Rank | Vertical |',
      '| --- | --- |',
      '| 1 | Example |',
      '```',
      '',
      'That is all.',
    ].join('\n');
    expect(extractMarkdownTables(fenced)).toHaveLength(0);

    const expectation = resolveTableExpectation({
      requestedArtifacts: [{ type: 'table', description: 'portfolio table' }],
      userConstraints: [],
    });
    expect(checkTableContract(fenced, expectation).map((i) => i.code)).toContain('table_missing');
  });

  it('still finds a real table that follows a fenced example', () => {
    const mixed = ['```', '| a | b |', '| - | - |', '```', '', goodTable].join('\n');
    const tables = extractMarkdownTables(mixed);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.rows).toHaveLength(2);
  });

  it('treats an escaped pipe as content, not a column boundary', () => {
    // Codex, PR #204: `A \| B` is one GFM cell. Splitting on it produced a
    // spurious extra cell, marked the table malformed, and burned repair passes.
    const escaped = [
      '| Metric | Notes |',
      '| --- | --- |',
      '| Throughput | high \\| low depending on tier |',
    ].join('\n');
    const tables = extractMarkdownTables(escaped);
    expect(tables[0]?.rows[0]).toHaveLength(2);
    expect(tables[0]?.rows[0]?.[1]).toBe('high | low depending on tier');

    const expectation = resolveTableExpectation({
      requestedArtifacts: [{ type: 'table', description: 'metrics table', exactCount: 1 }],
      userConstraints: [],
    });
    expect(checkTableContract(escaped, expectation)).toEqual([]);
  });

  it('accepts a single-hyphen delimiter row, matching remark-gfm', () => {
    // The GFM spec allows one hyphen per delimiter cell. Being stricter than
    // the renderer would report "table missing" for a table the reader sees.
    const minimal = ['| A | B |', '|-|-|', '| 1 | 2 |'].join('\n');
    expect(extractMarkdownTables(minimal)).toHaveLength(1);
  });

  it('recognises a table requested only through user constraints', () => {
    const expectation = resolveTableExpectation({
      requestedArtifacts: [],
      userConstraints: [{ description: 'Present the results as a comparison matrix.' }],
    });
    expect(expectation.required).toBe(true);
  });
});
