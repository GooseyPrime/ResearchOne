/**
 * Runs the report save itself with a stand-in transaction, so the guarantee is
 * tested by execution: a locked report and its citations are written through one
 * client, and a citation that cannot be saved leaves nothing committed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Statement {
  client: number;
  sql: string;
  params: unknown[];
}

const state = vi.hoisted(() => ({
  statements: [] as Array<{ client: number; sql: string; params: unknown[] }>,
  commits: 0,
  rollbacks: 0,
  clients: 0,
  storedChunks: new Set<string>(),
}));

vi.mock('../db/pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/pool')>();
  return {
    ...actual,
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
    withTransaction: vi.fn(async (work: (client: unknown) => Promise<unknown>) => {
      state.clients += 1;
      const id = state.clients;
      let sections = 0;
      const client = {
        query: async (sql: string, params: unknown[] = []) => {
          state.statements.push({ client: id, sql, params });
          if (/INSERT INTO reports/.test(sql)) return { rows: [{ id: 'report-1' }] };
          if (/INSERT INTO report_sections/.test(sql)) {
            sections += 1;
            return { rows: [] };
          }
          if (/SELECT id, section_order FROM report_sections/.test(sql)) {
            return { rows: Array.from({ length: sections }, (_, index) => ({ id: `section-${index + 1}`, section_order: index + 1 })) };
          }
          if (/SELECT id, source_id FROM chunks/.test(sql)) {
            return { rows: [...state.storedChunks].map((chunk) => ({ id: chunk, source_id: `source-of-${chunk}` })) };
          }
          return { rows: [] };
        },
      };
      try {
        const result = await work(client);
        state.commits += 1;
        return result;
      } catch (error) {
        state.rollbacks += 1;
        throw error;
      }
    }),
  };
});

vi.mock('../services/retention/retentionService', () => ({
  markReportFinalizedRetention: vi.fn(async () => undefined),
  markRunTerminalRetention: vi.fn(async () => undefined),
}));

import { saveReport } from '../services/reasoning/researchOrchestrator';

const REPORT = '# Bridges\n\n## History\nThe bridge opened in 1932 [1].\n\n## Use\nTraffic doubled by 1960 [2].';

function save(lockedOccurrences: Array<{ number: number; chunkId: string; quote: string }> | null) {
  return saveReport({
    runId: 'run-1',
    query: 'How did the bridge come to be built?',
    plan: {} as never,
    allChunks: [],
    synthesizerContent: REPORT,
    lockedOccurrences,
    verification: { passed: true, overall: 'PASS' } as never,
    supplementalText: '',
    supplementalAttachments: [],
    reportGateStatus: 'completed',
  });
}

const matching = (pattern: RegExp): Statement[] => state.statements.filter((statement) => pattern.test(statement.sql));

describe('saving a locked report', () => {
  beforeEach(() => {
    state.statements.length = 0;
    state.commits = 0;
    state.rollbacks = 0;
    state.clients = 0;
    state.storedChunks = new Set(['chunk-1', 'chunk-2']);
  });

  it('writes the report, its sections and its citations through one transaction', async () => {
    const reportId = await save([
      { number: 1, chunkId: 'chunk-1', quote: 'opened in 1932' },
      { number: 2, chunkId: 'chunk-2', quote: 'traffic doubled' },
    ]);
    expect(reportId).toBe('report-1');
    expect(state.commits).toBe(1);
    expect(state.rollbacks).toBe(0);

    const citations = matching(/INSERT INTO report_citations/);
    expect(citations).toHaveLength(2);
    const clients = new Set([...matching(/INSERT INTO reports/), ...matching(/INSERT INTO report_sections/), ...citations].map((statement) => statement.client));
    expect([...clients]).toEqual([1]);
    // Each citation sits on the section its number is in, with its passage, source, quote, order and number.
    const rows = citations.map((statement) => statement.params.slice(1));
    const sectionOf = (row: unknown[]) => row[0];
    expect(sectionOf(rows[0])).not.toBe(sectionOf(rows[1]));
    expect(rows[0].slice(1)).toEqual(['chunk-1', 'source-of-chunk-1', 'opened in 1932', 1, '[1]']);
    expect(rows[1].slice(1)).toEqual(['chunk-2', 'source-of-chunk-2', 'traffic doubled', 2, '[2]']);
  });

  it('commits nothing when a citation cannot be saved', async () => {
    state.storedChunks = new Set(['chunk-1']);
    await expect(
      save([
        { number: 1, chunkId: 'chunk-1', quote: 'opened in 1932' },
        { number: 2, chunkId: 'chunk-2', quote: 'traffic doubled' },
      ])
    ).rejects.toThrow(/no longer stored/);
    expect(state.commits).toBe(0);
    expect(state.rollbacks).toBe(1);
    // The report and section inserts were issued on the transaction that rolled back, and on no other.
    expect(matching(/INSERT INTO reports/).map((statement) => statement.client)).toEqual([1]);
    expect(state.clients).toBe(1);
  });

  it('writes no citation rows for a report saved without the lock', async () => {
    await save(null);
    expect(state.commits).toBe(1);
    expect(matching(/report_citations/)).toHaveLength(0);
  });

  it('clears earlier rows and writes none for a locked report that cites nothing', async () => {
    await save([]);
    expect(matching(/DELETE FROM report_citations/)).toHaveLength(1);
    expect(matching(/INSERT INTO report_citations/)).toHaveLength(0);
  });
});
