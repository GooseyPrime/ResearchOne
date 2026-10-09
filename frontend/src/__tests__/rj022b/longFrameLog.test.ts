/**
 * RJ-022B. The record a browser keeps of each time a page was held still, so
 * that the next time one is, the script that was running is written down.
 */
import { describe, expect, it } from 'vitest';
import { LONG_FRAME_MS, LONG_FRAME_STORAGE_KEY, keepLongFrame, longFrameRecord, readLongFrames } from '../../lib/longFrameLog';

function memoryStorage(initial: Record<string, string> = {}) {
  const held = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
  };
}

const AT = new Date('2026-10-09T22:40:00.000Z');

describe('RJ-022B: which script was running when a page was held still', () => {
  it('keeps a frame of two seconds or more, with its scripts longest first', () => {
    const record = longFrameRecord(
      {
        duration: 31_204.6,
        scripts: [
          { sourceURL: 'https://www.researchone.io/assets/index-abc.js', sourceFunctionName: 'render', invoker: 'TimerHandler:setTimeout', duration: 180 },
          { sourceURL: 'https://www.googletagmanager.com/gtag/js?id=G-C9CW32EES7&l=dataLayer', sourceFunctionName: '', invoker: 'https://www.googletagmanager.com/gtag/js', duration: 30_950.2 },
        ],
      },
      '/app/run/6622a18a-03f0-4317-a839-ddf2b73132cd?tab=1',
      AT
    );

    expect(record).toEqual({
      at: '2026-10-09T22:40:00.000Z',
      path: '/app/run/6622a18a-03f0-4317-a839-ddf2b73132cd',
      ms: 31_205,
      scripts: [
        { source: 'https://www.googletagmanager.com/gtag/js', fn: '', invoker: 'https://www.googletagmanager.com/gtag/js', ms: 30_950 },
        { source: 'https://www.researchone.io/assets/index-abc.js', fn: 'render', invoker: 'TimerHandler:setTimeout', ms: 180 },
      ],
    });
  });

  it('does not keep an ordinary slow frame', () => {
    expect(longFrameRecord({ duration: LONG_FRAME_MS - 1, scripts: [] }, '/app/dossiers', AT)).toBeNull();
    expect(longFrameRecord({ duration: Number.NaN }, '/app/dossiers', AT)).toBeNull();
  });

  it('keeps a frame the browser named no script for (time spent drawing, or in an extension)', () => {
    const record = longFrameRecord({ duration: 4_000 }, '/app/dossiers', AT);
    expect(record?.scripts).toEqual([]);
    expect(record?.ms).toBe(4_000);
  });

  it('names at most five scripts and never keeps a query string', () => {
    const scripts = Array.from({ length: 9 }, (_, i) => ({ sourceURL: `chrome-extension://abcdef/content-${i}.js?token=secret#x`, duration: 100 + i }));
    const record = longFrameRecord({ duration: 9_000, scripts }, '/app/dossiers', AT)!;
    expect(record.scripts).toHaveLength(5);
    expect(record.scripts[0].source).toBe('chrome-extension://abcdef/content-8.js');
    expect(JSON.stringify(record)).not.toContain('secret');
  });

  it('keeps the newest twenty in the browser, oldest first', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 23; i += 1) {
      keepLongFrame({ at: AT.toISOString(), path: `/app/run/${i}`, ms: 2_000 + i, scripts: [] }, storage);
    }
    const kept = readLongFrames(storage);
    expect(kept).toHaveLength(20);
    expect(kept[0].path).toBe('/app/run/3');
    expect(kept[19].path).toBe('/app/run/22');
  });

  it('reads nothing from storage that is empty, damaged or blocked, and never throws', () => {
    expect(readLongFrames(memoryStorage())).toEqual([]);
    expect(readLongFrames(memoryStorage({ [LONG_FRAME_STORAGE_KEY]: '{not json' }))).toEqual([]);
    expect(readLongFrames(memoryStorage({ [LONG_FRAME_STORAGE_KEY]: '{"a":1}' }))).toEqual([]);
    expect(readLongFrames(memoryStorage({ [LONG_FRAME_STORAGE_KEY]: '[null, 3, {"ms":"x"}]' }))).toEqual([]);
    expect(readLongFrames(null)).toEqual([]);
    const full = { getItem: () => '[]', setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => keepLongFrame({ at: AT.toISOString(), path: '/', ms: 2_000, scripts: [] }, full)).not.toThrow();
    expect(() => keepLongFrame({ at: AT.toISOString(), path: '/', ms: 2_000, scripts: [] }, null)).not.toThrow();
  });
});
