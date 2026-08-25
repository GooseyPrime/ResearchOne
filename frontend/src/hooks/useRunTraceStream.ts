/**
 * The single owner of live-trace state for one research run.
 *
 * WHY THIS EXISTS
 *
 * Four surfaces rendered a live trace and each owned its own state, so each
 * had its own answer to "is this event a duplicate" and "what order do these
 * go in". `ResearchStandardPage` and `ResearchDeepPage` deduped and sorted;
 * `ReportRevisionWorkspacePage` deduped but never sorted; `LiveRunPanel` did
 * neither. That is Rule 44 T3 in its purest form — one mapping, four
 * implementations, three of them subtly different.
 *
 * The renderer was never the problem. `LiveResearchTraceLog` is presentational
 * and always was; swapping `LiveRunPanel` onto it would have changed nothing,
 * because dedup and ordering live upstream of rendering. Making the STATE
 * shared is the fix, and it makes divergence structurally impossible: a
 * surface cannot disagree with an implementation it does not own.
 *
 * WHAT IT OWNS
 *
 *   - hydration from the run row's persisted `progress_events`
 *   - the Socket.IO subscription for this run
 *   - merging both sources through `mergeTraceEvents` (dedup)
 *   - chronological ordering
 *   - the bounded window
 *
 * WHY NO CROSS-MOUNT BUFFER
 *
 * Navigating away and back re-fetches the run row, and the server persists
 * every event it emits to `progress_events` — so the row IS the durable trace
 * and the mount hydrates a complete history from it. Caching the buffer across
 * mounts would only cover events emitted in the second between a socket
 * delivery and its persistence, which the next poll supplies anyway. If the
 * server ever stops persisting events, this comment is the thing that is no
 * longer true, and the buffer would need to move into the query cache.
 *
 * CONCURRENCY
 *
 * Per `runId` by construction. N concurrent runs are N instances of this hook
 * with no shared mutable state, which is what keeps the singular-`activeRun`
 * assumption from reappearing here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getResearchRun, type ResearchProgressEvent, type ResearchRun } from '../utils/api';
import { getSocket, subscribeToJob } from '../utils/socket';
import {
  eventsFromRunRow,
  mergeTraceEvents,
  normalizeProgressEvent,
  sortEventsChronological,
} from '../utils/traceEventWindow';
import { isInFlightRunStatus } from '../utils/researchRuns';

/** Bounded window. Matches the Standard/Deep pages this replaces. */
export const RUN_TRACE_MAX_EVENTS = 150;

/** Poll cadence while a run is in flight. */
const RUN_POLL_INTERVAL_MS = 5_000;

const NO_EVENTS: readonly ResearchProgressEvent[] = Object.freeze([]);

export { eventsFromRunRow, normalizeProgressEvent, sortEventsChronological };

export interface RunTraceStream {
  /** The polled run row, or null before the first successful read. */
  run: ResearchRun | null;
  /** Deduped, chronological, bounded. Oldest first — newest at the bottom. */
  traceEvents: ResearchProgressEvent[];
  /** Most recent event by timestamp, for progress chrome. */
  latest: ResearchProgressEvent | null;
  isLoading: boolean;
  isError: boolean;
}

export function useRunTraceStream(runId: string | undefined): RunTraceStream {
  const [traceEvents, setTraceEvents] = useState<ResearchProgressEvent[]>([]);

  const {
    data: run = null,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['research-run', runId],
    queryFn: () => getResearchRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isInFlightRunStatus(status) ? RUN_POLL_INTERVAL_MS : false;
    },
  });

  const ingest = useCallback((incoming: readonly ResearchProgressEvent[]) => {
    if (incoming.length === 0) return;
    // Merge unbounded, sort, THEN keep the newest N.
    //
    // This read `sortEventsChronological(mergeTraceEvents(prev, incoming, MAX))`,
    // which slices in MERGE order — arrival order — before anything is sorted.
    // An event that arrives late but belongs earlier could therefore evict a
    // genuinely newer event, and the window's contents depended on delivery
    // timing rather than on time (Codex, post-merge review of #227).
    setTraceEvents((prev) =>
      sortEventsChronological(mergeTraceEvents(prev, incoming, prev.length + incoming.length)).slice(
        -RUN_TRACE_MAX_EVENTS
      )
    );
  }, []);

  // A different run is a different trace. Clearing here rather than keying the
  // component means a caller that swaps runId in place cannot show run A's
  // events under run B's heading.
  useEffect(() => {
    setTraceEvents([]);
  }, [runId]);

  // Poll -> trace. Merge, never replace: the socket may already have delivered
  // events newer than this snapshot, and replacing would drop them only for the
  // next poll to bring them back, which is how the trace flickered.
  useEffect(() => {
    if (!run || !runId || run.id !== runId) return;
    ingest(eventsFromRunRow(run));
  }, [run, runId, ingest]);

  // Socket -> trace.
  useEffect(() => {
    if (!runId) return;
    subscribeToJob(runId);
    const socket = getSocket();

    const onProgress = (raw: ResearchProgressEvent) => {
      const update = normalizeProgressEvent(raw);
      if (update.runId && update.runId !== runId) return;
      ingest([{ ...update, runId }]);
    };

    socket.on('research:progress', onProgress);
    return () => {
      socket.off('research:progress', onProgress);
    };
  }, [runId, ingest]);

  const latest = useMemo(
    () => (traceEvents.length > 0 ? traceEvents[traceEvents.length - 1] : null),
    [traceEvents]
  );

  return {
    run,
    traceEvents: traceEvents.length > 0 ? traceEvents : (NO_EVENTS as ResearchProgressEvent[]),
    latest,
    isLoading,
    isError,
  };
}
