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

/**
 * Identity of a progress event, for deduplication (WO-AD done-item 5).
 *
 * The live trace has TWO writers for the same event. The Socket.IO handler
 * appends each `research:progress` as it arrives; the REST poll then reads
 * `research_runs.progress_events` -- which contains that same event, because
 * the server persisted it -- and writes the trace again. Nothing reconciled
 * them, so an event delivered on both paths rendered twice. The server was
 * verified clean: `progress_events` held no duplicates for either analysed
 * run. The doubling was entirely in this buffer.
 *
 * Events carry no server-assigned id, so identity is composed from the fields
 * the server both emits over the socket and persists to the row. `timestamp`
 * is the discriminator that makes repeats of the same stage distinguishable;
 * everything else guards against two events sharing a millisecond.
 */
export interface TraceEventIdentity {
  runId?: string;
  stage?: string;
  substep?: string;
  eventType?: string;
  timestamp?: string;
  message?: string;
  percent?: number;
}

export function traceEventKey(evt: TraceEventIdentity): string {
  return [
    evt.runId ?? '',
    evt.timestamp ?? '',
    evt.stage ?? '',
    evt.substep ?? '',
    evt.eventType ?? '',
    evt.percent ?? '',
    evt.message ?? '',
  ].join(' \u0000 ');
}

/**
 * Merge incoming events into an existing trace buffer, de-duplicated by
 * `traceEventKey`, keeping the newest N.
 *
 * On a key collision the INCOMING copy wins. The poll carries the persisted
 * row, which is authoritative over the socket's in-flight copy if they ever
 * disagree -- and for a socket-delivered event already present, replacing it
 * with an identical value is a no-op.
 *
 * Order is preserved: an event already in `prev` keeps its original position
 * rather than jumping to the end, so a poll arriving mid-run cannot reshuffle
 * a trace the user is reading. Callers still sort chronologically for display.
 */
export function mergeTraceEvents<T extends TraceEventIdentity>(
  prev: readonly T[],
  incoming: readonly T[],
  max: number
): T[] {
  if (max < 1) return [];

  const merged: T[] = [];
  const positionByKey = new Map<string, number>();

  for (const evt of [...prev, ...incoming]) {
    const key = traceEventKey(evt);
    const seenAt = positionByKey.get(key);
    if (seenAt === undefined) {
      positionByKey.set(key, merged.length);
      merged.push(evt);
    } else {
      merged[seenAt] = evt;
    }
  }

  return merged.slice(-max);
}
