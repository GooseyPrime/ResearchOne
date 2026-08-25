/** @vitest-environment jsdom */
/**
 * Regression suite for the WO-AF live-trace defects.
 *
 * Every case here was written against `LiveRunPanel` on `main` FIRST and
 * watched to fail before this hook existed (Rule 44 T1). What they caught:
 *
 *   A  the trace started empty on every mount — persisted history never loaded
 *   B  three duplicate emits rendered FIVE rows, because the row key was
 *      `${timestamp}-${stage}` and AnimatePresence retains ghost children on a
 *      key collision
 *   C  events rendered in arrival order, newest first, never sorted
 *   D  `.slice(0, 12)` bounded the state array while the DOM grew past it
 *
 * Each assertion below fails if its guarantee is removed from the hook.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchProgressEvent, ResearchRun } from '../../utils/api';

type Handler = (payload: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const subscribeToJob = vi.fn();

vi.mock('../../utils/socket', () => ({
  subscribeToJob: (...a: unknown[]) => subscribeToJob(...a),
  getSocket: () => ({
    on: (evt: string, fn: Handler) => {
      (handlers[evt] ||= []).push(fn);
    },
    off: (evt: string, fn: Handler) => {
      handlers[evt] = (handlers[evt] || []).filter((h) => h !== fn);
    },
  }),
}));

const getResearchRun = vi.fn();
vi.mock('../../utils/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getResearchRun: (...a: unknown[]) => getResearchRun(...a),
}));

import { RUN_TRACE_MAX_EVENTS, useRunTraceStream } from '../../hooks/useRunTraceStream';

const RUN_ID = '2d45d698-0000-4000-8000-000000000000';

function emit(payload: unknown) {
  (handlers['research:progress'] || []).forEach((h) => h(payload));
}

function evt(n: number, iso: string): ResearchProgressEvent {
  return {
    runId: RUN_ID,
    stage: 'reasoner',
    percent: 40,
    message: `Report section ${n}/25`,
    timestamp: iso,
    eventType: 'progress',
  };
}

function runRow(over: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: RUN_ID,
    title: 'raw prompt truncated',
    query: 'raw prompt',
    status: 'running',
    created_at: '2026-08-23T15:57:00.000Z',
    progress_stage: 'reasoner',
    progress_percent: 42,
    progress_message: 'Working',
    progress_updated_at: '2026-08-23T15:58:00.000Z',
    progress_events: [],
    ...over,
  } as ResearchRun;
}

/**
 * A row carrying no progress fields at all, so the hook synthesises no
 * placeholder and the trace contains exactly what the test puts in it.
 */
function bareRunRow(over: Partial<ResearchRun> = {}): ResearchRun {
  return runRow({
    progress_stage: null,
    progress_percent: null,
    progress_message: null,
    progress_updated_at: null,
    progress_events: [],
    ...over,
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** A wrapper whose client the test can drive, for cases that need a real refetch. */
function makeDrivableWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

beforeEach(() => {
  getResearchRun.mockResolvedValue(bareRunRow());
});

afterEach(() => {
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  vi.clearAllMocks();
});

describe('useRunTraceStream', () => {
  it('A — hydrates the full persisted history on mount', async () => {
    // The actual "loses view of the live research trace" bug. LiveRunPanel
    // initialised activities to [] and filled only from sockets received while
    // mounted, so navigating away discarded everything.
    const persisted = [1, 2, 3].map((n) => evt(n, `2026-08-23T15:5${n}:00.000Z`));
    getResearchRun.mockResolvedValue(runRow({ progress_events: persisted }));

    const { result } = renderHook(() => useRunTraceStream(RUN_ID), { wrapper });

    await waitFor(() => expect(result.current.traceEvents).toHaveLength(3));
    expect(result.current.traceEvents.map((e) => e.message)).toEqual([
      'Report section 1/25',
      'Report section 2/25',
      'Report section 3/25',
    ]);
  });

  it('B — an event delivered three times appears once', async () => {
    const { result } = renderHook(() => useRunTraceStream(RUN_ID), { wrapper });
    await waitFor(() => expect(result.current.run).not.toBeNull());

    const dup = evt(6, '2026-08-23T15:58:28.000Z');
    act(() => {
      emit(dup);
      emit({ ...dup });
      emit({ ...dup });
    });

    expect(result.current.traceEvents.filter((e) => e.message === 'Report section 6/25')).toHaveLength(1);
  });

  it('B2 — the same event from the poll and the socket appears once', async () => {
    // The two-writer case `mergeTraceEvents` was written for: the server
    // persists an event to `progress_events` AND emits it over the socket, so
    // both paths deliver the identical event and nothing reconciled them.
    const shared = evt(6, '2026-08-23T15:58:28.000Z');
    getResearchRun.mockResolvedValue(bareRunRow({ progress_events: [shared] }));

    const { result } = renderHook(() => useRunTraceStream(RUN_ID), { wrapper });
    await waitFor(() => expect(result.current.traceEvents).toHaveLength(1));

    act(() => emit({ ...shared }));

    expect(result.current.traceEvents).toHaveLength(1);
  });

  it('C — events arriving out of order come back chronological', async () => {
    const { result } = renderHook(() => useRunTraceStream(RUN_ID), { wrapper });
    await waitFor(() => expect(result.current.run).not.toBeNull());

    act(() => {
      emit(evt(1, '2026-08-23T15:57:18.000Z'));
      emit(evt(9, '2026-08-23T15:59:06.000Z'));
      emit(evt(8, '2026-08-23T15:58:51.000Z'));
    });

    expect(result.current.traceEvents.map((e) => e.message)).toEqual([
      'Report section 1/25',
      'Report section 8/25',
      'Report section 9/25',
    ]);
  });

  it('D — the window is bounded and keeps the NEWEST events', async () => {
    // `.slice(0, 12)` on a newest-first array keeps the newest; `.slice(-N)`
    // on an oldest-first array keeps the newest too. Pairing the wrong two is
    // the mistake rule 12-event-window-math exists for, so assert the content,
    // not just the length.
    const { result } = renderHook(() => useRunTraceStream(RUN_ID), { wrapper });
    await waitFor(() => expect(result.current.run).not.toBeNull());

    const total = RUN_TRACE_MAX_EVENTS + 20;
    act(() => {
      for (let n = 1; n <= total; n += 1) {
        emit(evt(n, new Date(Date.UTC(2026, 7, 23, 16, 0, 0) + n * 1000).toISOString()));
      }
    });

    expect(result.current.traceEvents).toHaveLength(RUN_TRACE_MAX_EVENTS);
    expect(result.current.traceEvents[result.current.traceEvents.length - 1].message).toBe(
      `Report section ${total}/25`
    );
    expect(result.current.traceEvents[0].message).toBe(`Report section ${total - RUN_TRACE_MAX_EVENTS + 1}/25`);
  });

  it('E — a row with no persisted events does not accumulate a placeholder per poll', async () => {
    // The defect this would have imported from useAttachResearchRun: its
    // fallback event stamped `new Date().toISOString()`, and the timestamp is
    // part of traceEventKey, so every poll produced a new key and the
    // placeholder would have stacked up one row at a time.
    //
    // The first version of this test called `rerender()`, which re-renders the
    // hook but does NOT refetch — the `run` object keeps its identity, so the
    // ingestion effect never re-runs and the test passed whatever the fallback
    // timestamp did (Copilot, #227). It has to drive a real refetch, which is
    // what a poll actually is.
    const { qc, Wrapper } = makeDrivableWrapper();
    getResearchRun.mockResolvedValue(runRow({ progress_events: [] }));

    const { result } = renderHook(() => useRunTraceStream(RUN_ID), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.traceEvents).toHaveLength(1));
    const firstStamp = result.current.traceEvents[0].timestamp;

    // Each poll returns a row that CHANGED — otherwise React Query's structural
    // sharing keeps the previous object, the `run`-dependent effect never
    // re-runs, and the test proves nothing whatever the fallback does. The
    // field that moves (`retry_attempts`) is deliberately not one the
    // placeholder is built from, so the placeholder's identity should be
    // unchanged across all three polls.
    for (let poll = 1; poll <= 3; poll += 1) {
      getResearchRun.mockResolvedValue(
        runRow({ progress_events: [], retry_attempts: poll })
      );
      await act(async () => {
        await qc.refetchQueries({ queryKey: ['research-run', RUN_ID] });
      });
    }

    // `refetchQueries` resolves when the FETCH completes; the observer's state
    // update lands in a later React commit, which is fast enough to look
    // synchronous locally and is not on a loaded CI runner. Asserting it bare
    // made this test flaky in exactly the environment that gates the merge —
    // it passed here and failed on GitHub with `expected 2 to be 3`.
    await waitFor(() => expect(result.current.run?.retry_attempts).toBe(3));
    expect(result.current.traceEvents).toHaveLength(1);
    // The guarantee: the placeholder's key is a function of the ROW, not of
    // when we happened to poll. A `new Date()` stamp mints a new key each time
    // and this assertion is what catches it.
    expect(result.current.traceEvents[0].timestamp).toBe(firstStamp);
  });

  it('F — switching runId does not show the previous run’s events', async () => {
    const { result, rerender } = renderHook(({ id }) => useRunTraceStream(id), {
      wrapper,
      initialProps: { id: RUN_ID },
    });
    await waitFor(() => expect(result.current.run).not.toBeNull());
    act(() => emit(evt(4, '2026-08-23T15:58:00.000Z')));
    expect(result.current.traceEvents.length).toBeGreaterThan(0);

    const OTHER = '36b25d18-0000-4000-8000-000000000000';
    getResearchRun.mockResolvedValue(bareRunRow({ id: OTHER }));
    rerender({ id: OTHER });

    expect(
      result.current.traceEvents.some((e) => e.message === 'Report section 4/25')
    ).toBe(false);
  });

  it('subscribes to the run room', async () => {
    renderHook(() => useRunTraceStream(RUN_ID), { wrapper });
    await waitFor(() => expect(subscribeToJob).toHaveBeenCalledWith(RUN_ID));
  });
});
