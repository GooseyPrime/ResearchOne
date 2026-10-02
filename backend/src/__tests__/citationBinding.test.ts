import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: unknown[][] = [];
const cleared: unknown[][] = [];

const client = {
  query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM report_sections')) {
      return { rows: [{ id: 'section-1', section_order: 1 }, { id: 'section-2', section_order: 2 }] };
    }
    if (sql.includes('FROM chunks')) {
      return { rows: [{ id: 'chunk-a', source_id: 'source-1' }, { id: 'chunk-b', source_id: 'source-2' }] };
    }
    if (/^\s*DELETE/i.test(sql)) cleared.push(params);
    else inserts.push(params);
    return { rows: [] };
  },
};

vi.mock('../db/pool', () => ({
  withTransaction: vi.fn(async (work: (c: typeof client) => Promise<unknown>) => work(client)),
}));

import { persistBoundCitations, writeBoundCitations } from '../services/reasoning/citationBinding';

describe('saving bound citations', () => {
  beforeEach(() => {
    inserts.length = 0;
    cleared.length = 0;
  });

  it('writes one row per citation with its section, passage, source, quote and number', async () => {
    const written = await persistBoundCitations({
      runId: 'run',
      reportId: 'report',
      bound: [
        { number: 1, chunkId: 'chunk-a', quote: 'Quote A.', sectionOrder: 1, order: 1 },
        { number: 2, chunkId: 'chunk-b', quote: 'Quote B.', sectionOrder: 2, order: 2 },
        { number: 1, chunkId: 'chunk-a', quote: 'Quote A again.', sectionOrder: null, order: 3 },
      ],
    });
    expect(written).toBe(3);
    // Earlier rows for this report are cleared first, so saving twice leaves one set.
    expect(cleared).toEqual([['report']]);
    expect(inserts).toEqual([
      ['report', 'section-1', 'chunk-a', 'source-1', 'Quote A.', 1, '[1]'],
      ['report', 'section-2', 'chunk-b', 'source-2', 'Quote B.', 2, '[2]'],
      ['report', null, 'chunk-a', 'source-1', 'Quote A again.', 3, '[1]'],
    ]);
  });

  it('fails the save when a cited passage is no longer stored', async () => {
    await expect(
      persistBoundCitations({
        runId: 'run',
        reportId: 'report',
        bound: [
          { number: 1, chunkId: 'chunk-a', quote: 'Quote A.', sectionOrder: 1, order: 1 },
          { number: 2, chunkId: 'chunk-gone', quote: 'Quote.', sectionOrder: 1, order: 2 },
        ],
      })
    ).rejects.toThrow('no longer stored');
  });

  it('writes through a transaction the caller owns, so the report and its citations commit together', async () => {
    const written = await writeBoundCitations(client, {
      runId: 'run',
      reportId: 'report',
      bound: [{ number: 1, chunkId: 'chunk-a', quote: 'Quote A.', sectionOrder: 2, order: 1 }],
    });
    expect(written).toBe(1);
    expect(inserts).toEqual([['report', 'section-2', 'chunk-a', 'source-1', 'Quote A.', 1, '[1]']]);
  });

  it('does nothing for a report with no citations', async () => {
    expect(await persistBoundCitations({ runId: 'run', reportId: 'report', bound: [] })).toBe(0);
  });
});
