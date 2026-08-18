import { describe, it, expect } from 'vitest';

import {
  buildItemDigest,
  mapWithConcurrency,
  partitionSectionPlan,
  SECTION_DRAFT_CONCURRENCY,
} from '../services/reasoning/reportGenerator';

/**
 * Parallel item-section drafting.
 *
 * Synthesis was 13m54s of a 44-minute run, drafted one section at a time even
 * though item sections share no state. These tests pin the two properties that
 * make concurrency safe: only genuinely independent sections are parallelised,
 * and the pool preserves order and failure semantics.
 */

const framing = (key: string) => ({ title: key, key, weight: 1 });
const item = (ordinal: number, lastOrdinal?: number) => ({
  title: `${ordinal}. Item`,
  key: `items_${ordinal}`,
  weight: 1,
  itemOrdinal: ordinal,
  ...(lastOrdinal === undefined ? {} : { itemLastOrdinal: lastOrdinal }),
});

describe('partitionSectionPlan', () => {
  it('splits framing from the independent item run', () => {
    const { leading, items, trailing } = partitionSectionPlan([
      framing('overview'),
      item(1),
      item(2),
      item(3),
      framing('ranking'),
      framing('caveats'),
    ]);
    expect(leading.map((s) => s.key)).toEqual(['overview']);
    expect(items.map((s) => s.key)).toEqual(['items_1', 'items_2', 'items_3']);
    expect(trailing.map((s) => s.key)).toEqual(['ranking', 'caveats']);
  });

  it('treats a plan with no item sections as entirely sequential', () => {
    const plan = [framing('overview'), framing('analysis'), framing('caveats')];
    const { leading, items, trailing } = partitionSectionPlan(plan);
    expect(leading).toHaveLength(3);
    expect(items).toHaveLength(0);
    expect(trailing).toHaveLength(0);
  });

  it('falls back to sequential when framing is interleaved between items', () => {
    // Expansion replaces the list section in place, so this should not happen.
    // If it ever does, drafting order may carry meaning — do not reorder.
    const { leading, items, trailing } = partitionSectionPlan([
      framing('overview'),
      item(1),
      framing('interlude'),
      item(2),
    ]);
    expect(items).toHaveLength(0);
    expect(leading).toHaveLength(4);
    expect(trailing).toHaveLength(0);
  });

  it('handles a plan that is nothing but items', () => {
    const { leading, items, trailing } = partitionSectionPlan([item(1), item(2)]);
    expect(leading).toHaveLength(0);
    expect(items).toHaveLength(2);
    expect(trailing).toHaveLength(0);
  });

  it('keeps grouped item ranges in the parallel set', () => {
    const { items } = partitionSectionPlan([framing('overview'), item(1, 4), item(5, 8)]);
    expect(items.map((s) => s.itemLastOrdinal)).toEqual([4, 8]);
  });
});

describe('mapWithConcurrency', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

  it('preserves input order regardless of completion order', async () => {
    const input = [40, 5, 30, 1, 20];
    const result = await mapWithConcurrency(input, 3, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value % 7));
      return value * 2;
    });
    expect(result).toEqual([80, 10, 60, 2, 40]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('stops claiming new work after the first failure', async () => {
    // Codex/Copilot P1: a rejection used to end only the rejecting worker while
    // its siblings kept pulling indices, so a failure on section 2 of 20 still
    // billed most of the remaining model calls before the error surfaced.
    const started: number[] = [];
    const error = new Error('drafter failed');

    await expect(
      mapWithConcurrency(Array.from({ length: 40 }, (_, i) => i), 4, async (index) => {
        started.push(index);
        await tick();
        if (index === 1) throw error;
        return index;
      })
    ).rejects.toBe(error);

    // At most the initial batch plus whatever was already claimed — nowhere
    // near all 40.
    expect(started.length).toBeLessThanOrEqual(12);
    expect(started.length).toBeLessThan(40);
  });

  it('reports the earliest failing index, not the first worker to reject', async () => {
    const early = new Error('section 0');
    const late = new Error('section 5');

    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5], 6, async (index) => {
        // Index 5 rejects first in time; index 0 is the meaningful failure.
        if (index === 5) throw late;
        if (index === 0) {
          await tick();
          await tick();
          throw early;
        }
        await tick();
        return index;
      })
    ).rejects.toBe(early);
  });

  it('lets in-flight work settle before rethrowing, leaving nothing orphaned', async () => {
    let settled = 0;
    let running = 0;
    const error = new Error('drafter failed');

    await expect(
      mapWithConcurrency(Array.from({ length: 8 }, (_, i) => i), 4, async (index) => {
        running += 1;
        await tick();
        running -= 1;
        settled += 1;
        if (index === 1) throw error;
        return index;
      })
    ).rejects.toBe(error);

    // No call is still in flight once the rejection surfaces.
    expect(running).toBe(0);
    expect(settled).toBeGreaterThanOrEqual(4);
  });

  it('does not spawn workers for an empty input', async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 4, async () => {
      calls += 1;
      return 1;
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it('runs serially when the limit is one', async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithConcurrency([1, 2, 3], 1, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
      return null;
    });
    expect(peak).toBe(1);
  });
});

describe('buildItemDigest', () => {
  const items = (n: number, bodyLen = 4000) =>
    Array.from({ length: n }, (_, i) => ({
      title: `${i + 1}. Item ${i + 1}`,
      content: 'x'.repeat(bodyLen),
    }));

  it('includes every item even when 40 drafts exceed the budget', () => {
    // Codex P1: 40 items at the 240-char floor need 9,600 chars against a 6,000
    // budget, and the old tail-slice kept only the last handful.
    const digest = buildItemDigest(items(40), 4500);
    for (let i = 1; i <= 40; i += 1) {
      expect(digest, `item ${i} missing`).toContain(`[${i}. Item ${i}]`);
    }
    expect(digest.length).toBeLessThanOrEqual(4500);
  });

  it('includes every item at a typical 20-item contract', () => {
    const digest = buildItemDigest(items(20), 4500);
    for (let i = 1; i <= 20; i += 1) {
      expect(digest).toContain(`[${i}. Item ${i}]`);
    }
    expect(digest.length).toBeLessThanOrEqual(4500);
  });

  it('carries body text when the budget allows it', () => {
    const digest = buildItemDigest(items(3), 4500);
    expect(digest).toContain('xxxx');
    expect(digest.length).toBeLessThanOrEqual(4500);
  });

  it('degrades to titles rather than dropping items', () => {
    // Tight budget: presence of all items beats detail on a few.
    const digest = buildItemDigest(items(30), 900);
    for (let i = 1; i <= 30; i += 1) {
      expect(digest).toContain(`${i}. Item ${i}`.slice(0, 6));
    }
    expect(digest.length).toBeLessThanOrEqual(900);
  });

  it('never exceeds its budget across a range of sizes', () => {
    for (const n of [1, 2, 5, 13, 20, 40]) {
      for (const budget of [300, 1200, 4500]) {
        expect(buildItemDigest(items(n), budget).length, `n=${n} budget=${budget}`)
          .toBeLessThanOrEqual(budget);
      }
    }
  });

  it('returns empty for no items or no budget', () => {
    expect(buildItemDigest([], 4500)).toBe('');
    expect(buildItemDigest(items(3), 0)).toBe('');
  });
});

describe('SECTION_DRAFT_CONCURRENCY', () => {
  it('is a sane positive default', () => {
    expect(SECTION_DRAFT_CONCURRENCY).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(SECTION_DRAFT_CONCURRENCY)).toBe(true);
  });
});
