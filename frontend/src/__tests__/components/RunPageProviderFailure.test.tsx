/** @vitest-environment jsdom */
/**
 * RJ-019. The run page for production run R1-20261009-1316-KTDDV-9, which
 * stopped at "Writing the report" when the AI provider refused for credit.
 *
 * What the page did, each watched to fail against main first:
 *   - printed the stored error for a customer: the step key, the model id,
 *     "status=402", "classification=quota_exceeded", "add credits"
 *   - printed "ABORTED" and "non-recoverable"
 *   - showed the same waiting line more than forty times, each with
 *     "pending=6; failed=1; waited=…ms" and a "chunks" tag
 *   - kept its socket listener on a run that had ended
 *   - offered "Run it again" as a link to a new request, which is a second run
 */
import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchProgressEvent, ResearchRun } from '../../utils/api';

type Handler = (payload: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const admin = { value: false };

vi.mock('../../utils/socket', () => ({
  subscribeToJob: vi.fn(),
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
const getResearchRuns = vi.fn();
const retryResearchRunFromFailure = vi.fn();
vi.mock('../../utils/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getResearchRun: (...a: unknown[]) => getResearchRun(...a),
  getResearchRuns: (...a: unknown[]) => getResearchRuns(...a),
  retryResearchRunFromFailure: (...a: unknown[]) => retryResearchRunFromFailure(...a),
}));
vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: () => admin.value }));
vi.mock('../../components/research/RunPlanGate', () => ({ default: () => null }));

import { LiveRunPanel } from '../../components/r1-dashboard/LiveRunPanel';
import { RUN_COULD_NOT_FINISH, sentenceForRunThatCannotRunAgain } from '../../utils/customerFailureText';

const RUN_ID = '6622a18a-03f0-4317-a839-ddf2b73132cd';
const STORED_ERROR =
  'Model provider request failed at synthesis (role=section_drafter, model=deepseek/deepseek-v3.2, status=402, classification=quota_exceeded): This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.';
const PLAIN =
  'The report could not be written because our AI service is temporarily unavailable. You have not been charged. Press Run it again to try again; you are only charged once, when a report is delivered.';

/** The fixed sentence as a run that cannot be run again is given it: it names the link the page offers (RJ-022B). */
const COULD_NOT_FINISH_SEND_AS_NEW = sentenceForRunThatCannotRunAgain(RUN_COULD_NOT_FINISH);

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 9, 13, 16, 0) + seconds * 1000).toISOString();

/** The trace as the run stored it: a two-minute wait reported every three seconds, then the stop. */
function storedTrace(): ResearchProgressEvent[] {
  const events: ResearchProgressEvent[] = [
    { runId: RUN_ID, stage: 'planning', percent: 8, message: 'Search plan ready', timestamp: at(5) },
    { runId: RUN_ID, stage: 'discovery', percent: 14, message: 'Checked 50 search results against the question: 38 relevant, 12 set aside', timestamp: at(40) },
  ];
  for (let i = 0; i < 42; i += 1) {
    events.push({
      runId: RUN_ID,
      stage: 'discovery',
      percent: 16,
      message: 'Reading the sources found: 18/25 ready',
      substep: 'discovery_ingest_waiting',
      detail: `pending=6; failed=1; waited=${(i + 1) * 3000}ms`,
      sourceCount: 18,
      chunkCount: 15,
      timestamp: at(60 + i * 3),
    });
  }
  events.push(
    { runId: RUN_ID, stage: 'retrieval', percent: 21, message: 'Search 1/3 of your library complete — 15 passages so far', detail: 'heat pump payback period', timestamp: at(200) },
    { runId: RUN_ID, stage: 'reasoning', percent: 50, message: 'Reasoning across sources...', model: 'deepseek/deepseek-v3.2', tokenUsage: { prompt: 9000, completion: 1200 }, timestamp: at(400) },
    {
      runId: RUN_ID,
      stage: 'aborted',
      percent: 80,
      message: 'Run aborted — failure was non-recoverable. Writing the report section by section...',
      eventType: 'run_aborted',
      timestamp: at(840),
      failure: { errorMessage: STORED_ERROR, retryable: false, failureMeta: { classification: 'quota_exceeded', status: 402, role: 'section_drafter' } },
    }
  );
  return events;
}

function stoppedRun(over: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: RUN_ID,
    run_ref: 'R1-20261009-1316-KTDDV-9',
    display_title: 'Heat pump payback for small firms',
    title: 'q',
    query: 'q',
    status: 'aborted',
    created_at: at(0),
    progress_stage: null,
    progress_percent: null,
    progress_message: null,
    progress_updated_at: null,
    error_message: STORED_ERROR,
    failed_stage: 'synthesis',
    failure_meta: { classification: 'quota_exceeded', status: 402, role: 'section_drafter', model: 'deepseek/deepseek-v3.2', retryable: false, terminal: true },
    progress_events: storedTrace(),
    ...over,
  } as ResearchRun;
}

let renders = 0;
function mount() {
  renders = 0;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/run/${RUN_ID}`]}>
        <Routes>
          <Route
            path="/app/run/:runId"
            element={
              <Profiler id="run-page" onRender={() => { renders += 1; }}>
                <LiveRunPanel />
              </Profiler>
            }
          />
          <Route path="/app/research" element={<div data-testid="entry-page">Entry</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function mountReady(run: ResearchRun) {
  getResearchRun.mockResolvedValue(run);
  getResearchRuns.mockResolvedValue([run]);
  const utils = mount();
  await waitFor(() => expect(screen.getByText(/^Live research trace/)).toBeTruthy());
  return utils;
}

/** Nothing on a customer's page may read like this. */
const NOT_FOR_CUSTOMERS = [
  /role=/i,
  /model=/i,
  /status=/i,
  /classification/i,
  /section_drafter/,
  /deepseek/i,
  /\b402\b/,
  /quota/i,
  /add credits/i,
  /aborted/i,
  /non-recoverable/i,
  /pending=/,
  /waited=/,
  /\bchunks?\b/i,
  /\d+p\+\d+c tok/,
];

beforeEach(() => {
  admin.value = false;
  retryResearchRunFromFailure.mockResolvedValue({ ok: true, status: 'queued' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  vi.clearAllMocks();
});

describe('run page — a run stopped because the AI provider refused', () => {
  it('shows a customer a plain sentence and none of the stored error, even when the server sent the stored error', async () => {
    await mountReady(stoppedRun());

    const page = document.body.textContent ?? '';
    for (const pattern of NOT_FOR_CUSTOMERS) expect(page).not.toMatch(pattern);
    // This run was stored as one that cannot be run again, so the sentence does not say "Press Run it again".
    expect(COULD_NOT_FINISH_SEND_AS_NEW).toContain('Press Send it as a new request');
    expect(screen.getAllByText(COULD_NOT_FINISH_SEND_AS_NEW).length).toBeGreaterThan(0);
    expect(page).not.toContain('Press Run it again');
  });

  it('shows the sentence the server chose for this failure', async () => {
    await mountReady(
      stoppedRun({
        status: 'failed',
        error_message: PLAIN,
        failure_meta: { retryable: true, terminal: false, customerMessageId: 'ai_service_unavailable_writing', customerMessage: PLAIN },
      })
    );
    expect(screen.getAllByText(PLAIN).length).toBeGreaterThan(0);
  });

  it('keeps the stored error, the model and the internal detail for an administrator', async () => {
    admin.value = true;
    await mountReady(stoppedRun());

    expect(screen.getByTestId('stored-error').textContent).toContain('status=402');
    const page = document.body.textContent ?? '';
    expect(page).toContain('[deepseek/deepseek-v3.2]');
    expect(page).toContain('pending=6; failed=1; waited=126000ms');
    // The plain sentence is still what the panel leads with.
    expect(screen.getAllByText(COULD_NOT_FINISH_SEND_AS_NEW).length).toBeGreaterThan(0);
  });

  it('folds a wait reported forty-two times into one line, and calls passages passages', async () => {
    await mountReady(stoppedRun());

    expect(screen.getAllByText('Reading the sources found: 18/25 ready')).toHaveLength(1);
    // 47 stored events are 6 lines: plan, relevance check, the wait, search, reasoning, the stop.
    expect(screen.getByText('Live research trace (6)')).toBeTruthy();
    expect(document.body.textContent).toContain('15 passages · 18 sources');
    // A search the customer's own request produced is still shown.
    expect(screen.getByText('heat pump payback period')).toBeTruthy();
  });

  it('runs the same run again when it can be, so it is one run and one charge', async () => {
    await mountReady(stoppedRun({ status: 'failed', failure_meta: { retryable: true, terminal: false } }));

    fireEvent.click(screen.getByRole('button', { name: 'Run it again' }));

    await waitFor(() => expect(retryResearchRunFromFailure).toHaveBeenCalledWith(RUN_ID));
  });

  it('offers a new request when the run can no longer be run again', async () => {
    await mountReady(stoppedRun());
    expect(screen.queryByRole('button', { name: 'Run it again' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Run it again' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Send it as a new request' }).getAttribute('href')).toContain('/app/research');
    expect(retryResearchRunFromFailure).not.toHaveBeenCalled();
  });
});

describe('run page — a run that has ended is quiet', () => {
  it('stops listening for progress once the run has stopped', async () => {
    await mountReady(stoppedRun());
    await waitFor(() => expect(handlers['research:progress'] ?? []).toHaveLength(0));
  });

  it('keeps listening while a run is in flight', async () => {
    await mountReady(stoppedRun({ status: 'running', error_message: null, failure_meta: undefined, progress_events: storedTrace().slice(0, 5) }));
    expect(handlers['research:progress'] ?? []).toHaveLength(1);
  });

  it('asks for the run once and never again, however long the page stays open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mountReady(stoppedRun());
    const rendersWhenReady = renders;

    // Ten minutes with the page open.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(getResearchRun).toHaveBeenCalledTimes(1);
    expect(getResearchRuns).toHaveBeenCalledTimes(1);
    // Nothing is arriving, so nothing is drawn again.
    expect(renders).toBe(rendersWhenReady);
  });

  it('draws a stopped run with a long trace in a handful of passes', async () => {
    await mountReady(stoppedRun());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(renders).toBeLessThan(10);
  });
});
