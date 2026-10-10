/**
 * A record, kept in this browser, of each time a page was held still (RJ-022B).
 *
 * Three orders in a row (RJ-019, RJ-022, RJ-022B) chased a browser tab that
 * stopped responding on a failed run's pages. None could reproduce it: with
 * the run's shape and size the pages open in under a second, in the test
 * environment and in Chromium against the production build. What was missing
 * each time was the one fact a recording in the affected browser would give:
 * which script was running.
 *
 * The browser can say. When a frame takes long, Chromium reports afterwards
 * how long it took and which scripts ran in it, with each script's address
 * (the application's own bundle, the analytics tag, a sign-in script, or a
 * browser extension) and the function that was called. This keeps the last
 * few such reports where whoever is diagnosing can read them: in the console,
 * under `localStorage['r1:long-frames']`, and on the diagnostics page for an
 * administrator.
 *
 * It records script addresses, function names, durations and the page's path.
 * It records no page text, sends nothing anywhere, and does nothing in a
 * browser that does not report long frames.
 */

/** A frame this long is a page a person would call stuck. Shorter ones are not kept. */
export const LONG_FRAME_MS = 2_000;
export const LONG_FRAME_STORAGE_KEY = 'r1:long-frames';
const KEEP = 20;
const SCRIPTS_PER_FRAME = 5;

export interface LongFrameScript {
  /** Where the script came from: its address without a query string. */
  source: string;
  /** The function that ran, when the browser names it. */
  fn: string;
  /** What called it: an event listener, a timer, a promise, a script tag. */
  invoker: string;
  ms: number;
}

export interface LongFrameRecord {
  at: string;
  /** The page's path when the frame ended. Never the query string. */
  path: string;
  /** How long the page was held. */
  ms: number;
  scripts: LongFrameScript[];
}

/** The parts of the browser's report this file reads. */
interface LongFrameEntry {
  duration: number;
  scripts?: ReadonlyArray<{ sourceURL?: string; sourceFunctionName?: string; invoker?: string; duration?: number }>;
}

const withoutQuery = (address: string): string => address.split(/[?#]/)[0].slice(0, 200);

/** One browser report as it is kept, or null for a frame too short to keep. */
export function longFrameRecord(entry: LongFrameEntry, path: string, now: Date = new Date()): LongFrameRecord | null {
  if (!(entry.duration >= LONG_FRAME_MS)) return null;
  const scripts = [...(entry.scripts ?? [])]
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, SCRIPTS_PER_FRAME)
    .map((script) => ({
      source: withoutQuery(script.sourceURL ?? '') || '(no address)',
      fn: (script.sourceFunctionName ?? '').slice(0, 80),
      invoker: (script.invoker ?? '').slice(0, 120),
      ms: Math.round(script.duration ?? 0),
    }));
  return { at: now.toISOString(), path: withoutQuery(path), ms: Math.round(entry.duration), scripts };
}

/** What has been kept in this browser, oldest first. Empty when nothing has, or storage cannot be read. */
export function readLongFrames(storage: Pick<Storage, 'getItem'> | null = safeStorage()): LongFrameRecord[] {
  try {
    const kept: unknown = JSON.parse(storage?.getItem(LONG_FRAME_STORAGE_KEY) ?? '[]');
    return Array.isArray(kept) ? (kept as LongFrameRecord[]).filter((item) => item && typeof item.ms === 'number' && Array.isArray(item.scripts)) : [];
  } catch {
    return [];
  }
}

/** Adds a record and keeps the newest twenty. A full or blocked storage loses the record, never the page. */
export function keepLongFrame(record: LongFrameRecord, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(LONG_FRAME_STORAGE_KEY, JSON.stringify([...readLongFrames(storage), record].slice(-KEEP)));
  } catch {
    // Nothing to do: the record is still in the console.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

let started = false;

/** Starts recording. Called once when the application starts; safe to call again. */
export function startLongFrameLog(): void {
  if (started || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  const supported = (PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] }).supportedEntryTypes ?? [];
  if (!supported.includes('long-animation-frame')) return;
  started = true;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const record = longFrameRecord(entry as unknown as LongFrameEntry, window.location.pathname);
        if (!record) continue;
        keepLongFrame(record);
        console.warn(`[ResearchOne] This page was held for ${(record.ms / 1000).toFixed(1)} s`, record);
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {
    started = false;
  }
}
