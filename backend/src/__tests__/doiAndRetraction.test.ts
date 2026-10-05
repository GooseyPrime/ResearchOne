/**
 * Slice 4, part 3: link checks on cited sources.
 *
 * A source whose DOI does not resolve is never shown to the writer, so nothing
 * can cite it. A retracted source may be cited only by a sentence that says it
 * was retracted. A failed check never empties a report or stops a run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ calls: [] as Array<{ sql: string; params: unknown[] }>, fail: null as null | { code?: string; message: string } }));
vi.mock('../db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    db.calls.push({ sql, params });
    if (db.fail) throw Object.assign(new Error(db.fail.message), { code: db.fail.code });
    return [];
  }),
  queryOne: vi.fn(async () => null),
  withTransaction: vi.fn(),
  adminQuery: vi.fn(async () => []),
}));

import { checkDois, doiOf, editorialNoticeFrom, type DoiHttp } from '../services/verification/doiResolve';
import { applyDoiChecks, formatLockedContext, issuePassages, stripUnstatedRetractions, unstatedRetractions, type LockedPassage } from '../services/reasoning/citationLock';
import { finalizeLockedReportForSave } from '../services/reasoning/reportGenerator';
import { recordDoiChecks } from '../services/reasoning/citationBinding';

const RETRACTED_RECORD = { message: { 'updated-by': [{ type: 'retraction', label: 'Retraction' }] } };

/** A stand-in for the network: what each address answers, per method. */
function fakeHttp(answers: Record<string, Partial<Record<'HEAD' | 'GET', number | 'none'>>>, records: Record<string, unknown> = {}): DoiHttp & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async status(method, url) {
      asked.push(`${method} ${url}`);
      const answer = Object.entries(answers).find(([doi]) => url.endsWith(doi))?.[1]?.[method];
      if (answer === undefined || answer === 'none') throw new Error('timeout of 8000ms exceeded');
      return answer;
    },
    async json(url) {
      asked.push(`JSON ${url}`);
      const record = Object.entries(records).find(([doi]) => url.endsWith(encodeURIComponent(doi)))?.[1];
      if (!record) throw new Error('Request failed with status code 404');
      return record;
    },
  };
}

describe('reading a DOI from a source address', () => {
  it('reads the usual forms and nothing else', () => {
    expect(doiOf('https://doi.org/10.1016/j.enpol.2016.01.011')).toBe('10.1016/j.enpol.2016.01.011');
    expect(doiOf('http://dx.doi.org/10.1000/ABC.')).toBe('10.1000/abc');
    expect(doiOf('doi:10.1000/x%2Fy')).toBe('10.1000/x/y');
    expect(doiOf('https://example.org/article/10')).toBeNull();
    expect(doiOf(null)).toBeNull();
  });
});

describe('checking DOIs', () => {
  it('passes a DOI that answers 200', async () => {
    const result = (await checkDois(['10.1000/ok'], fakeHttp({ '10.1000/ok': { HEAD: 200 } }))).get('10.1000/ok');
    expect(result).toMatchObject({ status: 'resolved', notice: null });
  });

  it('marks a DOI that answers 404 as unresolved', async () => {
    const result = (await checkDois(['10.1000/gone'], fakeHttp({ '10.1000/gone': { HEAD: 404 } }))).get('10.1000/gone');
    expect(result).toMatchObject({ status: 'unresolved', networkFailure: false });
  });

  it('asks again with GET when HEAD is refused, and passes on 200', async () => {
    const http = fakeHttp({ '10.1000/shy': { HEAD: 405, GET: 200 } });
    expect((await checkDois(['10.1000/shy'], http)).get('10.1000/shy')?.status).toBe('resolved');
    expect(http.asked.filter((line) => line.startsWith('GET '))).toHaveLength(1);
    const refused = fakeHttp({ '10.1000/shy': { HEAD: 403, GET: 404 } });
    expect((await checkDois(['10.1000/shy'], refused)).get('10.1000/shy')?.status).toBe('unresolved');
  });

  it('marks a DOI that never answers as unresolved, without throwing', async () => {
    const result = (await checkDois(['10.1000/slow', '10.1000/ok'], fakeHttp({ '10.1000/slow': { HEAD: 'none' }, '10.1000/ok': { HEAD: 200 } }))).get('10.1000/slow');
    expect(result).toMatchObject({ status: 'unresolved', networkFailure: true });
  });

  it('treats the check as unavailable when no lookup at all got an answer', async () => {
    const results = await checkDois(['10.1000/a', '10.1000/b', '10.1000/c'], fakeHttp({}));
    expect([...results.values()].map((result) => result.status)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('reads a retraction, and a correction, from the publisher record', async () => {
    const http = fakeHttp({ '10.1000/bad': { HEAD: 200 }, '10.1000/fixed': { HEAD: 200 } }, { '10.1000/bad': RETRACTED_RECORD, '10.1000/fixed': { message: { 'updated-by': [{ type: 'erratum' }] } } });
    const results = await checkDois(['10.1000/bad', '10.1000/fixed'], http);
    expect(results.get('10.1000/bad')).toMatchObject({ status: 'resolved', notice: { kind: 'retracted' } });
    expect(results.get('10.1000/fixed')).toMatchObject({ status: 'resolved', notice: { kind: 'corrected' } });
    expect(editorialNoticeFrom({ message: { 'updated-by': [{ type: 'correction' }, { type: 'retraction' }] } })?.kind).toBe('retracted');
    expect(editorialNoticeFrom({ message: {} })).toBeNull();
    expect(editorialNoticeFrom(null)).toBeNull();
  });

  it('asks about each DOI once', async () => {
    const http = fakeHttp({ '10.1000/ok': { HEAD: 200 } });
    await checkDois(['10.1000/ok', '10.1000/ok'], http);
    expect(http.asked.filter((line) => line.startsWith('HEAD '))).toHaveLength(1);
  });
});

const chunks = [
  { id: 'c1', content: 'Costs rose after 1979.' },
  { id: 'c2', content: 'The trial found a large effect.' },
  { id: 'c3', content: 'A web page says so.' },
  { id: 'c4', content: 'A dead link said otherwise.' },
];
const sources = [
  { title: 'Costs', url: 'https://doi.org/10.1000/ok' },
  { title: 'Trial', url: 'https://doi.org/10.1000/bad' },
  { title: 'Page', url: 'https://example.org/page' },
  { title: 'Gone', url: 'https://doi.org/10.1000/gone' },
];
const checks = new Map([
  ['10.1000/ok', { status: 'resolved', notice: null }],
  ['10.1000/bad', { status: 'resolved', notice: { kind: 'retracted', text: 'The publisher has retracted this work.' } }],
  ['10.1000/gone', { status: 'unresolved', notice: null }],
]);

function passages(): LockedPassage[] {
  const applied = applyDoiChecks(chunks, sources, checks, doiOf);
  return issuePassages(applied.chunks, applied.sources).map((passage, index) => ({ ...passage, retracted: applied.retracted[index], doiCheck: applied.checked[index] }));
}

describe('what a locked report may cite after the link check', () => {
  it('leaves out a source whose DOI does not resolve, so no marker exists for it', () => {
    const applied = applyDoiChecks(chunks, sources, checks, doiOf);
    expect(applied.dropped).toBe(1);
    expect(applied.chunks.map((chunk) => chunk.id)).toEqual(['c1', 'c2', 'c3']);
    const shown = passages();
    expect(shown.map((passage) => passage.marker)).toEqual(['P1', 'P2', 'P3']);
    expect(formatLockedContext(shown)).not.toContain('dead link');
  });

  it('keeps a statement supported by a resolved source when its other source was left out', () => {
    const shown = passages();
    // The surviving passage keeps a marker the writer can cite; the dead one has none.
    expect(shown.find((passage) => passage.chunkId === 'c1')?.marker).toBe('P1');
    expect(shown.some((passage) => passage.chunkId === 'c4')).toBe(false);
  });

  it('changes nothing when the check was unavailable or the source has no DOI', () => {
    const unknown = new Map([['10.1000/ok', { status: 'unknown', notice: null }], ['10.1000/bad', { status: 'unknown', notice: null }], ['10.1000/gone', { status: 'unknown', notice: null }]]);
    const applied = applyDoiChecks(chunks, sources, unknown, doiOf);
    expect(applied.chunks).toHaveLength(4);
    expect(applied.retracted).toEqual([false, false, false, false]);
    expect(applied.checked[2]).toBeNull();
  });

  it('shows the writer that a source was retracted', () => {
    const context = formatLockedContext(passages());
    expect(context).toMatch(/\[P2\] Trial \(RETRACTED by its publisher\./);
    expect(context).not.toMatch(/\[P1\][^\n]*RETRACTED/);
  });

  it('finds a retracted source cited by a sentence that does not say so', () => {
    const shown = passages();
    expect(unstatedRetractions('Costs rose [P1]. The trial found a large effect [P2].', shown)).toEqual(['P2']);
    expect(unstatedRetractions('Costs rose [P1]. A trial, since retracted, found a large effect [P2].', shown)).toEqual([]);
    expect(unstatedRetractions('The paper was later withdrawn [P2].', shown)).toEqual([]);
    // Saying so in a neighbouring sentence is not saying so in the sentence.
    expect(unstatedRetractions('One study was retracted. The trial found a large effect [P2].', shown)).toEqual(['P2']);
  });

  it('takes the citation off such a sentence and leaves the others alone', () => {
    const shown = passages();
    expect(stripUnstatedRetractions('Costs rose [P1]. The trial found a large effect [P1, P2]. It was big [P2].', shown)).toBe('Costs rose [P1]. The trial found a large effect [P1]. It was big.');
    const stated = 'A trial, since retracted, found a large effect [P2].';
    expect(stripUnstatedRetractions(stated, shown)).toBe(stated);
  });

  it('does not let a later rewrite save a retracted source cited as if it stood', () => {
    const shown = passages();
    const saved = finalizeLockedReportForSave('# Report\n\n## Findings\nCosts rose [P1]. The trial found a large effect [P2].\n', 'q', shown).finalized;
    expect(saved.occurrences.map((occurrence) => occurrence.chunkId)).toEqual(['c1']);
    const kept = finalizeLockedReportForSave('# Report\n\n## Findings\nCosts rose [P1]. A trial, since retracted, found a large effect [P2].\n', 'q', shown).finalized;
    expect(kept.occurrences.map((occurrence) => occurrence.chunkId)).toEqual(['c1', 'c2']);
  });

  it('does nothing to a report with no retracted source', () => {
    const plain = issuePassages(chunks, sources);
    const text = 'The trial found a large effect [P2].';
    expect(unstatedRetractions(text, plain)).toEqual([]);
    expect(stripUnstatedRetractions(text, plain)).toBe(text);
  });
});

describe('saving what the link check found', () => {
  beforeEach(() => {
    db.calls.length = 0;
    db.fail = null;
  });

  it('writes one update per finding', async () => {
    await recordDoiChecks('r1', [
      { chunkId: 'c1', status: 'resolved', notice: null },
      { chunkId: 'c3', status: 'resolved', notice: null },
      { chunkId: 'c2', status: 'resolved', notice: 'The publisher has retracted this work.' },
    ]);
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0].params).toEqual(['r1', 'resolved', null, ['c1', 'c3']]);
    expect(db.calls[1].params).toEqual(['r1', 'resolved', 'The publisher has retracted this work.', ['c2']]);
  });

  it('carries on when the columns are not there yet, or the save fails', async () => {
    db.fail = { code: '42703', message: 'column "resolve_status" of relation "report_citations" does not exist' };
    await expect(recordDoiChecks('r1', [{ chunkId: 'c1', status: 'resolved', notice: null }])).resolves.toBeUndefined();
    db.fail = { message: 'connection lost' };
    await expect(recordDoiChecks('r1', [{ chunkId: 'c1', status: 'resolved', notice: null }])).resolves.toBeUndefined();
  });
});

describe('the switch', () => {
  const orchestrator = readFileSync(join(__dirname, '../services/reasoning/researchOrchestrator.ts'), 'utf8');
  const writer = readFileSync(join(__dirname, '../services/reasoning/reportGenerator.ts'), 'utf8');

  it('asks the network only behind DOI_RESOLVE_ENABLED, and only once', () => {
    expect(orchestrator.match(/checkDois\(/g)).toHaveLength(1);
    const at = orchestrator.indexOf('checkDois(');
    const guard = orchestrator.lastIndexOf('if (doiResolveEnabled()) {', at);
    expect(guard).toBeGreaterThan(-1);
    // Nothing closes the guarded block between the switch and the call.
    expect(orchestrator.slice(guard, at)).not.toMatch(/\n {8}\}/);
  });

  it('holds every draft and the saved report to the retraction rule', () => {
    expect(writer.match(/unstatedRetractions\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(writer).toMatch(/const toSave = stripUnstatedRetractions\(/);
  });
});
