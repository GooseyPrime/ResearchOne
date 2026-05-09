import { describe, expect, it } from 'vitest';
import { appendKeepingNewestAtBottom } from './traceEventWindow';

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
