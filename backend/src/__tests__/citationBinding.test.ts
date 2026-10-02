import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
        { number: 1, chunkId: 'chunk-a', quote: 'Quote A again.', sectionOrder: 2, order: 3 },
      ],
    });
    expect(written).toBe(3);
    // Earlier rows for this report are cleared first, so saving twice leaves one set.
    expect(cleared).toEqual([['report']]);
    expect(inserts).toEqual([
      ['report', 'section-1', 'chunk-a', 'source-1', 'Quote A.', 1, '[1]'],
      ['report', 'section-2', 'chunk-b', 'source-2', 'Quote B.', 2, '[2]'],
      ['report', 'section-2', 'chunk-a', 'source-1', 'Quote A again.', 3, '[1]'],
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

  it('fails the save when a citation has no saved section', async () => {
    await expect(
      persistBoundCitations({
        runId: 'run',
        reportId: 'report',
        bound: [{ number: 1, chunkId: 'chunk-a', quote: 'Quote A.', sectionOrder: null, order: 1 }],
      })
    ).rejects.toThrow('no saved section');
    await expect(
      persistBoundCitations({
        runId: 'run',
        reportId: 'report',
        bound: [{ number: 1, chunkId: 'chunk-a', quote: 'Quote A.', sectionOrder: 9, order: 1 }],
      })
    ).rejects.toThrow('no saved section');
  });

  it('does nothing for a report with no citations', async () => {
    expect(await persistBoundCitations({ runId: 'run', reportId: 'report', bound: [] })).toBe(0);
  });
});

/**
 * The save of a locked report sits deep inside the research job, which needs a
 * database, a queue and live models to run. Its wiring is guarded at the source
 * level, as the other orchestrator guards are.
 */
describe('locked citations in the research job', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/services/reasoning/researchOrchestrator.ts'), 'utf8');

  it('hands the finalized citations to the report save', () => {
    expect(source).toMatch(/lockedOccurrences = finalized\.occurrences;/);
    const call = source.slice(source.indexOf('await saveReport({'));
    expect(call.slice(0, call.indexOf('});'))).toMatch(/\blockedOccurrences,/);
  });

  it('saves them inside the transaction that saves the report', () => {
    const save = source.slice(source.indexOf('async function saveReport('));
    const next = save.indexOf('\nasync function ', 10);
    const body = next > 0 ? save.slice(0, next) : save;
    const transaction = body.indexOf('withTransaction(');
    const write = body.indexOf('await writeBoundCitations(client as unknown as CitationWriter');
    expect(transaction).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(transaction);
    expect(body).not.toMatch(/persistBoundCitations\(/);
  });

  it('runs the model-based mapper only for a report that is not locked', () => {
    const calls = [...source.matchAll(/await mapAndPersistCitations\(/g)];
    expect(calls).toHaveLength(1);
    expect(source).toMatch(/if \(lockedOccurrences === null\) await mapAndPersistCitations\(/);
    expect(source).not.toMatch(/persistBoundCitations/);
  });

  it('leaves the citations unset when the lock is off', () => {
    expect(source).toMatch(/let lockedOccurrences: CitationOccurrence\[\] \| null = null;/);
    const assignments = [...source.matchAll(/\blockedOccurrences = /g)];
    expect(assignments).toHaveLength(1);
  });
});
