/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentRuns } from '../../components/r1-dashboard/RecentRuns';
import { mapApiRunToVaultRun } from '../../lib/researchone/runMappers';
import type { ResearchRun } from '../../utils/api';

const { getResearchRunsMock } = vi.hoisted(() => ({ getResearchRunsMock: vi.fn() }));

vi.mock('../../utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/api')>();
  return { ...actual, getResearchRuns: getResearchRunsMock };
});

const QUEUED_RUN = {
  id: 'f1e74c06-53d3-44a6-b095-d15fb703dd99',
  title: 'Compare EU and US device pathways',
  query: 'Compare EU and US device pathways',
  status: 'queued',
  created_at: '2026-08-25T10:00:00.000Z',
  progress_percent: 0,
} as unknown as ResearchRun;

function renderRecentRuns() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RecentRuns />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getResearchRunsMock.mockResolvedValue([QUEUED_RUN]);
});

afterEach(() => cleanup());

describe('a run list states only what the run actually did', () => {
  it('carries no invented metrics out of the mapper', () => {
    // These were hardcoded — 0 sources, 0 contradictions, and an evidence tier
    // of "supported" — on every run the API returned, whatever it had done.
    const mapped = mapApiRunToVaultRun(QUEUED_RUN);
    expect(mapped.sourcesRetrieved).toBeUndefined();
    expect(mapped.contradictionsDetected).toBeUndefined();
    expect(mapped.evidenceTier).toBeUndefined();
    expect(mapped.mode).toBeUndefined();
  });

  it('does not badge a queued run with a corroboration tier', async () => {
    // Observed in production on this run id: status queued, progress 0%, zero
    // sources — and a SUPPORTED badge next to it.
    renderRecentRuns();
    await waitFor(() =>
      expect(screen.getByText('Compare EU and US device pathways')).toBeInTheDocument()
    );
    expect(screen.queryByText('SUPPORTED')).toBeNull();
    expect(screen.queryByText('VERIFIED')).toBeNull();
    expect(screen.queryByText('CORROBORATED')).toBeNull();
    expect(screen.queryByText('STANDARD')).toBeNull();
    // The things it does know are still shown.
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });
});
