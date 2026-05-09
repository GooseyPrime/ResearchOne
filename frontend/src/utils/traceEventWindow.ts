/**
 * Bounded trace / live-event buffers: keep the newest N items with oldest at the front
 * after append (newest-at-bottom before any chronological sort).
 *
 * @see `.cursor/rules/12-event-window-math.mdc` — never pair `[new, ...prev]` with `slice(-N)`.
 */
export function appendKeepingNewestAtBottom<T>(prev: readonly T[], incoming: T, max: number): T[] {
  if (max < 1) return [];
  return [...prev, incoming].slice(-max);
}
