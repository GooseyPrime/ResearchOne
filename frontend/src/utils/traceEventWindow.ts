import type { ResearchProgressEvent, ResearchRun } from './api';
import { plainProgressText } from '@/lib/researchone/plainWords';
import { readerStageLabel } from '@/lib/researchone/stageLabels';

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
    message: plainProgressText(evt.message) || readerStageLabel(evt.stage),
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
      message: plainProgressText(run.progress_message) || 'Resuming run…',
      timestamp: stamp,
    }),
  ];
}

/** Events that mark a run starting, stopping or finishing. They are never folded into a neighbour. */
function isMilestone(evt: ResearchProgressEvent): boolean {
  return Boolean(evt.failure) || (evt.eventType != null && evt.eventType !== 'progress');
}

/**
 * Whether two consecutive events are the same line said again: updates of one
 * wait (the step reports "18/25 ready", then "19/25 ready"), or the very same
 * message twice.
 */
function isSameLineAgain(prev: ResearchProgressEvent, next: ResearchProgressEvent): boolean {
  if (isMilestone(prev) || isMilestone(next)) return false;
  if (prev.stage !== next.stage) return false;
  const sameWait = Boolean(prev.substep) && prev.substep === next.substep && /waiting/i.test(prev.substep ?? '');
  return sameWait || prev.message === next.message;
}

/**
 * Fold repeated updates into one updating line.
 *
 * A step that waits reports on a timer. Production run
 * R1-20261009-1316-KTDDV-9 showed "Reading the sources found: 18/25 ready"
 * more than forty times in a row, one line every three seconds. The reader
 * needs the latest state of that wait, once. The line kept is the newest, so
 * its words and its time are current, and `repeatCount` says how many updates
 * it stands for.
 *
 * This is for display only. The buffer the hook keeps, and what the server
 * stored, are untouched.
 */
export function collapseRepeatedUpdates(
  events: readonly ResearchProgressEvent[]
): ResearchProgressEvent[] {
  const out: ResearchProgressEvent[] = [];
  for (const evt of events) {
    const prev = out[out.length - 1];
    if (prev && isSameLineAgain(prev, evt)) {
      out[out.length - 1] = { ...evt, repeatCount: (prev.repeatCount ?? 1) + 1 };
    } else {
      out.push(evt);
    }
  }
  return out;
}

/**
 * A notice from the worker that it has picked the run up (RJ-018).
 *
 * It is not a step of the run: it has no percentage, and until RJ-018 it had no
 * time either. Each page received it twice (once on the run's channel, once on
 * the all-pages broadcast), stamped each copy with the browser's own clock, and
 * showed "Starting 0%" twice — after later steps where the browser's clock ran
 * ahead of the server's, which also pulled the progress bar back to 0%. The run's
 * real first step ("starting", 1%) is written by the pipeline and arrives with
 * the run row, so the notice is never a row of the trace.
 */
export function isWorkerNotice(evt: Partial<ResearchProgressEvent> | null | undefined): boolean {
  if (!evt) return false;
  // The server's name for it since RJ-018. Read as text: it is not one of the trace's own event types.
  if ((evt.eventType as string | undefined) === 'worker_notice') return true;
  return evt.stage === 'started' && !Number.isFinite(evt.percent) && !evt.message;
}

/** A run that stopped and was started again begins its count again. */
function isRestartMarker(evt: ResearchProgressEvent): boolean {
  return (
    evt.eventType === 'run_resumed' ||
    evt.eventType === 'run_failed' ||
    evt.eventType === 'run_aborted' ||
    evt.stage === 'failed' ||
    evt.stage === 'aborted'
  );
}

export interface TraceProgress {
  /** 0–100, and never lower than a value already shown for this attempt. */
  percent: number;
  /** The step the run is on: the step of the furthest point it has reached. */
  stage: string | null;
}

/**
 * How far a run has got, for the progress bar and the step row (RJ-018).
 *
 * Progress on screen never moves backwards. The furthest point any event of
 * this attempt reports is where the run is; an event that reports less (a
 * second "starting" when the run picks up after its plan is confirmed, a late
 * or repeated event) does not pull the display back. Only a real restart — the
 * run stopped and was started again — begins the count again.
 *
 * `events` are in time order, oldest first, as `useRunTraceStream` holds them.
 * `row` is the run row's own progress, which can be ahead of the events on a
 * page that has only just opened.
 */
export function traceProgress(
  events: readonly ResearchProgressEvent[],
  row?: { progress_percent?: number | null; progress_stage?: string | null } | null
): TraceProgress {
  let percent = -1;
  let stage: string | null = null;
  for (const evt of events) {
    if (isRestartMarker(evt)) {
      percent = -1;
      stage = null;
      continue;
    }
    if (isWorkerNotice(evt) || !Number.isFinite(evt.percent)) continue;
    if (evt.percent >= percent) {
      percent = evt.percent;
      stage = evt.stage || stage;
    }
  }
  const rowPercent = typeof row?.progress_percent === 'number' && Number.isFinite(row.progress_percent) ? row.progress_percent : null;
  if (rowPercent !== null && rowPercent > percent) {
    percent = rowPercent;
    stage = row?.progress_stage || stage;
  }
  if (stage === null) stage = row?.progress_stage || null;
  return { percent: Math.max(0, Math.min(100, Math.round(percent))), stage };
}

/**
 * The percentage printed on each row of the trace, in the order given (RJ-018).
 * A row never shows less than the row above it within one attempt, for the
 * same reason the bar does not move back.
 */
export function tracePercents(events: readonly ResearchProgressEvent[]): number[] {
  let furthest = 0;
  return events.map((evt) => {
    if (isRestartMarker(evt)) {
      furthest = 0;
      return Number.isFinite(evt.percent) ? Math.round(evt.percent) : 0;
    }
    if (Number.isFinite(evt.percent) && evt.percent > furthest) furthest = evt.percent;
    return Math.round(furthest);
  });
}
