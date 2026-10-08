/**
 * Slice 6. Whether a report names its sources by where they were read follows
 * the record its run made when it wrote the report, never the switch as it is
 * set later.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ record: null as string | null, fail: false }));
vi.mock('../db/pool', () => ({
  query: vi.fn(async () => {
    if (h.fail) throw new Error('connection lost');
    return [{ authority_tiers: h.record }];
  }),
}));

import { authorityWordsForRun } from '../services/eval/readerView';
import { STORED_CITATION_SQL } from '../services/eval/runHarness';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('the run\'s record of authority tiers', () => {
  afterEach(() => {
    h.record = null;
    h.fail = false;
    delete process.env.AUTHORITY_TIERS_ENABLED;
  });

  it('follows the record, not the switch as set later', async () => {
    h.record = 'true';
    expect(await authorityWordsForRun('run-1')).toBe(true);
    h.record = null;
    process.env.AUTHORITY_TIERS_ENABLED = 'true';
    // Turned on after the report was written: the report reads as it was written.
    expect(await authorityWordsForRun('run-1')).toBe(false);
  });

  it('is off with no run, and never throws', async () => {
    expect(await authorityWordsForRun(null)).toBe(false);
    h.fail = true;
    expect(await authorityWordsForRun('run-1')).toBe(false);
  });

  it('is written by the run that writes the report, and cleared on a retry without the switch', () => {
    const source = readFileSync(resolve(__dirname, '../services/reasoning/researchOrchestrator.ts'), 'utf8');
    // Before the synthesis stage, so a run that skips it (a reference lookup) still records it.
    expect(source.indexOf(`'{"authorityTiers": true}'`)).toBeLessThan(source.indexOf("if (shouldRunPipelineStage(orchProfile, 'synthesis')) {"));
    expect(source.indexOf(`'{"authorityTiers": true}'`)).toBeGreaterThan(source.indexOf('const reportForGates = (markdown: string): string =>'));
    expect(source).toMatch(/if \(authorityTiersEnabled\(\)\) \{\s*await query\(`UPDATE research_runs SET corpus_after = COALESCE\(corpus_after, '\{\}'::jsonb\) \|\| '\{"authorityTiers": true\}'::jsonb WHERE id=\$1`/);
    expect(source).toContain(`corpus_after - 'authorityTiers' WHERE id=$1 AND corpus_after ? 'authorityTiers'`);
  });
});

describe('the harness reads a citation\'s source through its passage when it has no source id', () => {
  it('joins sources on the citation\'s source or its passage\'s', () => {
    expect(STORED_CITATION_SQL).toContain('COALESCE(rc.source_id, c.source_id) AS "sourceId"');
    expect(STORED_CITATION_SQL).toContain('LEFT JOIN sources src ON src.id = COALESCE(rc.source_id, c.source_id)');
    // The passage is joined before the source that depends on it.
    expect(STORED_CITATION_SQL.indexOf('LEFT JOIN chunks c')).toBeLessThan(STORED_CITATION_SQL.indexOf('LEFT JOIN sources src'));
  });
});

describe('the reading page finds a citation\'s source through its passage when it has no source id', () => {
  it('selects and joins the source through the passage', () => {
    const source = readFileSync(resolve(__dirname, '../services/formatting/readerEvidence.ts'), 'utf8');
    expect(source).toContain('COALESCE(rc.source_id, c.source_id) AS source_id');
    expect(source).toContain('LEFT JOIN sources s ON s.id = COALESCE(rc.source_id, c.source_id)');
    expect(source.indexOf('LEFT JOIN chunks c ON c.id = rc.chunk_id')).toBeLessThan(source.indexOf('LEFT JOIN sources s ON s.id = COALESCE'));
  });
});
