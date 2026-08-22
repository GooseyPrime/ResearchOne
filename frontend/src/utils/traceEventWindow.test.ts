import { describe, expect, it } from 'vitest';
import { appendKeepingNewestAtBottom, mergeTraceEvents, traceEventKey } from './traceEventWindow';

describe('appendKeepingNewestAtBottom', () => {
  it('retains the newest event when the buffer is already at capacity', () => {
    const cap = 150;
    const prev = Array.from({ length: cap }, (_, i) => ({ id: i }));
    const newest = { id: 999 };
    const out = appendKeepingNewestAtBottom(prev, newest, cap);
    expect(out).toHaveLength(cap);
    expect(out[cap - 1]).toEqual(newest);
  });

  it('does not drop the incoming item when under capacity', () => {
    const prev = [{ id: 1 }, { id: 2 }];
    const out = appendKeepingNewestAtBottom(prev, { id: 3 }, 150);
    expect(out).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });
});

/**
 * Regression cover for the doubled live trace (WO-AD done-item 5).
 *
 * The socket handler and the REST poll both write the same event into the
 * trace buffer. The server was verified clean -- `progress_events` contained
 * no duplicates -- so the doubling was purely this buffer appending an event
 * it already held.
 */
describe('mergeTraceEvents', () => {
  const evt = (over: Record<string, unknown> = {}) => ({
    runId: 'run-1',
    stage: 'retrieval',
    percent: 25,
    message: 'Retrieving evidence',
    timestamp: '2026-08-22T10:00:00.000Z',
    ...over,
  });

  it('renders an event once when the socket and the poll both deliver it', () => {
    const fromSocket = [evt()];
    const fromPoll = [evt()];
    expect(mergeTraceEvents(fromSocket, fromPoll, 150)).toEqual([evt()]);
  });

  it('keeps genuinely distinct events, including repeats of one stage', () => {
    const a = evt({ timestamp: '2026-08-22T10:00:00.000Z' });
    const b = evt({ timestamp: '2026-08-22T10:00:05.000Z', percent: 30 });
    const c = evt({ stage: 'reasoning', timestamp: '2026-08-22T10:00:09.000Z', percent: 40 });
    expect(mergeTraceEvents([a], [b, c], 150)).toEqual([a, b, c]);
  });

  it('separates same-millisecond events by substep', () => {
    const a = evt({ substep: 'query_1' });
    const b = evt({ substep: 'query_2' });
    expect(mergeTraceEvents([a], [b], 150)).toHaveLength(2);
  });

  it('holds a duplicate in place rather than moving it to the end', () => {
    const first = evt({ timestamp: '2026-08-22T10:00:00.000Z' });
    const second = evt({ timestamp: '2026-08-22T10:00:05.000Z', percent: 30 });
    const out = mergeTraceEvents([first, second], [first], 150);
    expect(out).toEqual([first, second]);
  });

  it('lets the incoming copy win on a collision', () => {
    const socketCopy = evt({ detail: undefined } as Record<string, unknown>);
    const persisted = { ...evt(), detail: 'from the persisted row' };
    expect(mergeTraceEvents([socketCopy], [persisted], 150)).toEqual([persisted]);
  });

  it('keeps the newest N once merged', () => {
    const prev = Array.from({ length: 150 }, (_, i) =>
      evt({ timestamp: `2026-08-22T10:00:${String(i).padStart(2, '0')}.000Z` })
    );
    const newest = evt({ timestamp: '2026-08-22T11:00:00.000Z' });
    const out = mergeTraceEvents(prev, [newest], 150);
    expect(out).toHaveLength(150);
    expect(out[149]).toEqual(newest);
  });

  it('returns an empty buffer for a non-positive capacity', () => {
    expect(mergeTraceEvents([evt()], [evt()], 0)).toEqual([]);
  });
});

describe('traceEventKey', () => {
  it('does not collide across field boundaries', () => {
    // Without a separator, stage "a" + substep "bc" and stage "ab" + substep "c"
    // would produce the same key.
    expect(traceEventKey({ stage: 'a', substep: 'bc' })).not.toBe(
      traceEventKey({ stage: 'ab', substep: 'c' })
    );
  });
});
