import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: unknown[][] = [];

vi.mock('../db/pool', () => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes('FROM report_sections')) {
      return [
        { id: 'section-1', section_order: 1 },
        { id: 'section-2', section_order: 2 },
      ];
    }
    if (sql.includes('FROM chunks')) {
      return [
        { id: 'chunk-a', source_id: 'source-1' },
        { id: 'chunk-b', source_id: 'source-2' },
      ];
    }
    return [];
  }),
  withTransaction: vi.fn(async (work: (client: { query: (sql: string, params: unknown[]) => Promise<void> }) => Promise<void>) =>
    work({
      query: async (_sql: string, params: unknown[]) => {
        inserts.push(params);
      },
    })
  ),
}));

import { persistBoundCitations } from '../services/reasoning/citationBinding';

describe('saving bound citations', () => {
  beforeEach(() => {
    inserts.length = 0;
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

  it('does nothing for a report with no citations', async () => {
    expect(await persistBoundCitations({ runId: 'run', reportId: 'report', bound: [] })).toBe(0);
  });
});
