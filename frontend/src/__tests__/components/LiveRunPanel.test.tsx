/** @vitest-environment jsdom */
/**
 * The WO-AF reproduction cases, now against the rendered workspace.
 *
 * Each of these was written against `LiveRunPanel` on `main` and watched to
 * fail first (Rule 44 T1). What they caught, in the DOM rather than in state:
 *
 *   - the trace was empty on every mount; persisted history never loaded
 *   - three duplicate emits produced FIVE rows, because the row key was
 *     `${timestamp}-${stage}` and `AnimatePresence` retains ghost children on
 *     a key collision — so the DOM grew past the 12-item state cap
 *   - rows rendered in arrival order, newest first
 *   - the list had no scroll container and grew the page
 *   - the raw prompt was the `<h1>`
 *   - completion navigated to /app/dossiers after 1.5s
 *   - a queued run at 0% displayed "Source corroboration tier: SUPPORTED"
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchProgressEvent, ResearchRun } from '../../utils/api';

type Handler = (payload: unknown) => void;
const handlers: Record<string, Handler[]> = {};

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
vi.mock('../../utils/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getResearchRun: (...a: unknown[]) => getResearchRun(...a),
  getResearchRuns: (...a: unknown[]) => getResearchRuns(...a),
}));

// The plan gate is a surface of its own — it reaches for Clerk auth, billing
// tier and plan preferences. Stubbing it keeps this suite about the workspace
// (title, trace, outcome, navigation) while still asserting the workspace hands
// it the run it is supposed to.
vi.mock('../../components/research/RunPlanGate', () => ({
  default: ({ runId, runStatus }: { runId: string; runStatus?: string }) =>
    runStatus === 'plan_pending_confirmation' ? (
      <div data-testid="plan-gate" data-run-id={runId} />
    ) : null,
}));

import { LiveRunPanel } from '../../components/r1-dashboard/LiveRunPanel';

const RUN_ID = '2d45d698-0000-4000-8000-000000000000';
const REF = 'R1-20260823-1557-4K7Q2-9';
const RAW_PROMPT =
  '# Research Objective\n\n**Context:** Do a full site review of the content in Volume I.\n\n---\n\nEvaluate the claims using reasoning capabilities.';

function emit(event: string, payload: unknown) {
  (handlers[event] || []).forEach((h) => h(payload));
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
    run_ref: REF,
    display_title: 'Site review of Volume I claims',
    title: RAW_PROMPT.slice(0, 200),
    query: RAW_PROMPT,
    status: 'running',
    created_at: '2026-08-23T15:57:00.000Z',
    progress_stage: 'reasoner',
    progress_percent: 42,
    progress_message: null,
    progress_updated_at: null,
    progress_events: [],
    ...over,
  } as ResearchRun;
}

function mount(initialPath = `/app/run/${RUN_ID}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/app/run/:runId" element={<LiveRunPanel />} />
          <Route path="/app/research" element={<div data-testid="entry-page">Entry</div>} />
          <Route path="/app/dossiers" element={<div data-testid="dossiers-page">Dossiers</div>} />
          <Route path="/app/dossiers/:id" element={<div data-testid="dossier-detail">Report</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function mountReady(over: Partial<ResearchRun> = {}) {
  getResearchRun.mockResolvedValue(runRow(over));
  const utils = mount();
  await waitFor(() => expect(screen.getByText('RUN_STATUS')).toBeTruthy());
  return utils;
}

beforeEach(() => {
  getResearchRun.mockResolvedValue(runRow());
  getResearchRuns.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  vi.clearAllMocks();
});

describe('LiveRunPanel — heading', () => {
  it('does not put the raw prompt in the heading', async () => {
    await mountReady();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Site review of Volume I claims');
    expect(heading.textContent).not.toContain('# Research Objective');
  });

  it('keeps the request available, collapsed, below the heading', async () => {
    await mountReady();
    // Present as a disclosure the reader can open — not removed, and not the
    // page heading either.
    const toggle = screen.getByRole('button', { name: /REQUEST/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('falls back to the run reference rather than the prompt', async () => {
    await mountReady({ display_title: null });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(REF);
  });
});

describe('LiveRunPanel — trace', () => {
  it('shows history that arrived while the user was on another page', async () => {
    const persisted = [1, 2, 3].map((n) => evt(n, `2026-08-23T15:5${n}:00.000Z`));
    await mountReady({ progress_events: persisted });
    await waitFor(() => expect(screen.getByText('Report section 1/25')).toBeTruthy());
    expect(screen.getByText('Report section 3/25')).toBeTruthy();
  });

  it('renders one row for an event delivered three times', async () => {
    await mountReady();
    const dup = evt(6, '2026-08-23T15:58:28.000Z');
    await act(async () => {
      emit('research:progress', dup);
      emit('research:progress', { ...dup });
      emit('research:progress', { ...dup });
    });
    expect(screen.queryAllByText('Report section 6/25')).toHaveLength(1);
  });

  it('renders rows chronologically, oldest first', async () => {
    await mountReady();
    await act(async () => {
      emit('research:progress', evt(1, '2026-08-23T15:57:18.000Z'));
      emit('research:progress', evt(9, '2026-08-23T15:59:06.000Z'));
      emit('research:progress', evt(8, '2026-08-23T15:58:51.000Z'));
    });
    expect(screen.getAllByText(/Report section \d+\/25/).map((n) => n.textContent)).toEqual([
      'Report section 1/25',
      'Report section 8/25',
      'Report section 9/25',
    ]);
  });

  it('puts the trace in a scroll container instead of growing the page', async () => {
    await mountReady();
    const label = screen.getByText(/Live research trace/i);
    const panel = label.closest('.r1-panel') as HTMLElement;
    expect(panel.querySelector('[class*="overflow-y-auto"]')).not.toBeNull();
  });
});

describe('LiveRunPanel — outcome', () => {
  it('does not navigate away when the run completes', async () => {
    // The old behaviour: setTimeout(() => navigate('/app/dossiers'), 1500).
    getResearchRun.mockResolvedValue(runRow({ status: 'completed' }));
    mount();
    await waitFor(() => expect(screen.getByText('RUN_STATUS')).toBeTruthy());

    await act(async () => {
      emit('research:completed', { runId: RUN_ID, reportId: 'r-1' });
      await new Promise((r) => setTimeout(r, 1_600));
    });

    expect(screen.queryByTestId('dossiers-page')).toBeNull();
    expect(screen.getByRole('link', { name: /Open report/i })).toBeTruthy();
  });

  it('offers diagnostics on a failed run and keeps the trace', async () => {
    await mountReady({
      status: 'failed',
      error_message: 'Retrieval yielded no usable sources',
      progress_events: [evt(1, '2026-08-23T15:57:18.000Z')],
    });
    expect(screen.getByText('Retrieval yielded no usable sources')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Report section 1/25')).toBeTruthy());
  });
});

describe('LiveRunPanel — honesty of the status panel', () => {
  it('claims no evidence tier for a queued run that has produced none', async () => {
    // Observed in production: a QUEUED run at 0% with zero sources retrieved
    // displaying "Source corroboration tier: SUPPORTED", hardcoded in
    // mapApiRunToVaultRun.
    await mountReady({ status: 'queued', progress_percent: 0 });
    const status = screen.getByText('RUN_STATUS').closest('.r1-panel') as HTMLElement;
    expect(within(status).queryByText(/corroboration/i)).toBeNull();
    expect(within(status).queryByText(/SUPPORTED/i)).toBeNull();
  });
});

describe('LiveRunPanel — navigation', () => {
  it('links to the entry page without going through Dossiers', async () => {
    await mountReady();
    const nav = screen.getByRole('navigation', { name: /Run navigation/i });
    const newRequest = within(nav).getByRole('link', { name: /New request/i });
    expect(newRequest.getAttribute('href')).toBe('/app/research');
  });

  it('links directly to other runs in flight', async () => {
    const other = runRow({
      id: '36b25d18-0000-4000-8000-000000000000',
      display_title: 'Second concurrent run',
      status: 'running',
    });
    getResearchRuns.mockResolvedValue([runRow(), other]);
    await mountReady();

    const nav = screen.getByRole('navigation', { name: /Run navigation/i });
    await waitFor(() =>
      expect(within(nav).getByRole('link', { name: /Second concurrent run/i })).toBeTruthy()
    );
    expect(
      within(nav).getByRole('link', { name: /Second concurrent run/i }).getAttribute('href')
    ).toBe('/app/run/36b25d18-0000-4000-8000-000000000000');
  });
});

describe('LiveRunPanel — plan gate', () => {
  it('renders the gate in the workspace instead of sending the user away', async () => {
    // The old page redirected a plan_pending run to
    // `/app/research?runId=…#plan`, which is how the header pill ended up
    // landing somewhere different depending on the run's state.
    await mountReady({ status: 'plan_pending_confirmation' });
    const gate = screen.getByTestId('plan-gate');
    expect(gate.getAttribute('data-run-id')).toBe(RUN_ID);
    expect(screen.queryByTestId('entry-page')).toBeNull();
  });

  it('hides the pipeline while the plan is awaiting confirmation', async () => {
    // Nothing has run yet, so a stage tracker at 0% would be inviting the
    // reader to watch progress that cannot start until they act.
    await mountReady({ status: 'plan_pending_confirmation' });
    expect(screen.queryByText('PIPELINE_PROGRESS')).toBeNull();
  });
});
