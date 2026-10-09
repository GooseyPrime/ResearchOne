/** @vitest-environment jsdom */
/**
 * RJ-022B. The diagnostics page is open to a run's owner. Names the system
 * uses for itself (the model profile, the engine, why a run is locked) are for
 * administrators; a customer's page does not print them.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RJ022_RUN_ID } from '../rj022/failedRunFixture';
import { rj022bFailedRun, rj022bFailedRunForCustomer } from './manySourcesFixture';

const admin = { value: false };
const run = { value: rj022bFailedRunForCustomer() };

vi.mock('../../utils/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getResearchRun: async () => run.value,
  getRunArtifacts: async () => ({ sources: [], claims: [], checkpoints: [], sourcesTotal: 0, claimsTotal: 0, progressEvents: [] }),
}));
vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: () => admin.value }));

import FailedRunReportPage from '../../pages/FailedRunReportPage';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/app/reports/run/${RJ022_RUN_ID}`]}>
        <Routes>
          <Route path="/app/reports/run/:runId" element={<FailedRunReportPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const INTERNAL_NAMES = /INVESTIGATIVE_SYNTHESIS|Objective:|Engine:|budget locked|non-recoverable/;

afterEach(() => cleanup());

describe('RJ-022B: diagnostics page, internal names', () => {
  it('a customer is not shown the model profile, the engine or why the run is locked', async () => {
    admin.value = false;
    // The server sends a customer `terminal: true` so the page knows the run cannot be run again.
    run.value = rj022bFailedRunForCustomer();
    mount();

    await screen.findByRole('heading', { name: 'Research Run Failed' });
    expect(screen.getByText(/Retries used:/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(INTERNAL_NAMES);
  });

  it('an administrator still is', async () => {
    admin.value = true;
    run.value = rj022bFailedRun();
    mount();

    await screen.findByRole('heading', { name: 'Research Run Failed' });
    expect(document.body.textContent).toContain('INVESTIGATIVE_SYNTHESIS');
    expect(document.body.textContent).toContain('budget locked (non_recoverable_classification)');
  });
});
