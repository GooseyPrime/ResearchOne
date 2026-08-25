/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResearchRun } from '../../utils/api';

const getResearchRuns = vi.fn();
vi.mock('../../utils/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getResearchRuns: (...a: unknown[]) => getResearchRuns(...a),
}));

import ActiveRunBadge from '../../components/research/ActiveRunBadge';

function run(over: Partial<ResearchRun>): ResearchRun {
  return {
    id: 'run-a',
    status: 'running',
    title: 'raw prompt',
    query: 'raw prompt',
    created_at: '2026-08-23T15:00:00.000Z',
    progress_stage: 'reasoner',
    progress_percent: 40,
    ...over,
  } as ResearchRun;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ActiveRunBadge />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ActiveRunBadge', () => {
  it('renders nothing when no run is in flight', async () => {
    getResearchRuns.mockResolvedValue([run({ status: 'completed' })]);
    const { container } = mount();
    await waitFor(() => expect(getResearchRuns).toHaveBeenCalled());
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('links a single run straight to its workspace, in one hop', async () => {
    // It used to link to `/app/research?runId=…`, which redirected to
    // `/app/run/…` — two hops to a page with no way back.
    getResearchRuns.mockResolvedValue([run({ id: 'run-a' })]);
    mount();
    const link = await screen.findByRole('link');
    expect(link.getAttribute('href')).toBe('/app/run/run-a');
  });

  it('sends a run awaiting its plan to the gate anchor', async () => {
    getResearchRuns.mockResolvedValue([run({ id: 'run-a', status: 'plan_pending_confirmation' })]);
    mount();
    const link = await screen.findByRole('link');
    expect(link.getAttribute('href')).toBe('/app/run/run-a#plan');
  });

  it('represents every concurrent run, not just the top-priority one', async () => {
    // The defect: the store held ONE activeRun, chosen by priority from the
    // full in-flight list, and the rest were discarded. With three runs going,
    // two of them did not exist as far as the header was concerned.
    getResearchRuns.mockResolvedValue([
      run({ id: 'run-a', display_title: 'First run' }),
      run({ id: 'run-b', display_title: 'Second run' }),
      run({ id: 'run-c', display_title: 'Third run', status: 'plan_pending_confirmation' }),
    ]);
    mount();

    const toggle = await screen.findByRole('button', { name: /3 runs/i });
    fireEvent.click(toggle);

    const menu = screen.getByRole('menu');
    for (const [title, href] of [
      ['First run', '/app/run/run-a'],
      ['Second run', '/app/run/run-b'],
      ['Third run', '/app/run/run-c#plan'],
    ]) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(title, 'i') }).getAttribute('href')).toBe(href);
    }
  });

  it('offers a way to start another request from the list', async () => {
    getResearchRuns.mockResolvedValue([run({ id: 'run-a' }), run({ id: 'run-b' })]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /2 runs/i }));
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: /New request/i }).getAttribute('href')
    ).toBe('/app/research');
  });

  it('names runs by their title, never by the raw prompt', async () => {
    getResearchRuns.mockResolvedValue([
      run({ id: 'run-a', display_title: null, run_ref: 'R1-20260823-1557-4K7Q2-9', query: '# Research Objective…' }),
      run({ id: 'run-b', display_title: 'A real title' }),
    ]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /2 runs/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('R1-20260823-1557-4K7Q2-9')).toBeTruthy();
    expect(within(menu).queryByText(/# Research Objective/)).toBeNull();
  });

  it('closes the list on Escape', async () => {
    getResearchRuns.mockResolvedValue([run({ id: 'run-a' }), run({ id: 'run-b' })]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /2 runs/i }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
