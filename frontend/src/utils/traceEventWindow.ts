import type { ResearchProgressEvent, ResearchRun } from './api';

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


/**
 * Trace normalization, in ONE module.
 *
 * `mergeTraceEvents` above was already shared. The sort was not: identical
 * `sortEventsChronological` functions were defined inside
 * `ResearchStandardPage` and `ResearchDeepPage`, `LiveRunPanel` had neither,
 * and `ReportRevisionWorkspacePage` merged without ever sorting. Three
 * different answers to one question, which is Rule 44 T3.
 *
 * Dedup and ordering now live beside each other, so a surface that reaches for
 * one is looking straight at the other.
 */
export function normalizeProgressEvent(evt: ResearchProgressEvent): ResearchProgressEvent {
  return {
    ...evt,
    stage: evt.stage || 'planning',
    percent: Number.isFinite(evt.percent) ? evt.percent : 0,
    message: evt.message || evt.stage || 'Update',
    timestamp: evt.timestamp || new Date().toISOString(),
  };
}

export function sortEventsChronological(
  events: readonly ResearchProgressEvent[]
): ResearchProgressEvent[] {
  return [...events].sort((a, b) =>
    String(a.timestamp || '').localeCompare(String(b.timestamp || ''))
  );
}

/**
 * Trace events carried by a run row.
 *
 * The synthesised fallback for a row with no `progress_events` takes its
 * timestamp from the row, never from `Date.now()`. A generated timestamp is
 * part of `traceEventKey`, so a fresh one on every poll would produce a NEW
 * key each time and the dedup would have nothing to match — the placeholder
 * would accumulate one row per poll, which is the exact duplication this hook
 * exists to remove. A row with no timestamp of its own yields no fallback at
 * all rather than an undedupable one.
 */
export function eventsFromRunRow(run: ResearchRun): ResearchProgressEvent[] {
  const raw = run.progress_events;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .filter((e): e is ResearchProgressEvent => Boolean(e) && typeof e === 'object')
      .map((e) => normalizeProgressEvent({ ...e, runId: e.runId || run.id }));
  }

  const stamp = run.progress_updated_at || run.started_at || run.created_at;
  if (!stamp) return [];
  if (run.progress_message == null && run.progress_percent == null && !run.progress_stage) {
    return [];
  }

  return [
    normalizeProgressEvent({
      runId: run.id,
      stage: run.progress_stage || run.status || 'planning',
      percent: run.progress_percent ?? 0,
      message: run.progress_message || 'Resuming run…',
      timestamp: stamp,
    }),
  ];
}
