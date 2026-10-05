/** @vitest-environment jsdom */
/**
 * A follow-up report sends a citation style only when the parent run had one or
 * one is chosen. The form used to open on APA and always send it, which
 * replaced the report default without anyone choosing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  fetchSpinoffPrefill: vi.fn(),
  startResearchSpinoff: vi.fn(),
}));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return {
    ...actual,
    fetchSpinoffPrefill: mocks.fetchSpinoffPrefill,
    startResearchSpinoff: mocks.startResearchSpinoff,
    getResearchV2EnsemblePresets: vi.fn().mockResolvedValue({}),
  };
});
vi.mock('@/hooks/useResearchRunAddons', () => ({
  useResearchRunAddons: () => ({ selectedAddons: [], selectedAddonsForSubmit: [], toggleAddon: vi.fn() }),
}));
vi.mock('@/hooks/useBillingSubscription', () => ({
  useBillingSubscriptionQuery: () => ({ data: undefined, isLoading: false, isError: false, authReady: true }),
  effectiveEntitlementTier: () => 'pro',
}));
vi.mock('@/components/research/RunAddonToggles', () => ({ default: () => null }));
vi.mock('@/components/research/AttachmentDropZone', () => ({ default: () => null }));

import ReportSpinoffPage from '../../pages/ReportSpinoffPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/reports/report-1/spinoff']}>
        <Routes>
          <Route path="/app/reports/:reportId/spinoff" element={<ReportSpinoffPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function styleSelect(): Promise<HTMLSelectElement> {
  const label = await screen.findByText('Citation style');
  const select = label.parentElement?.querySelector('select');
  if (!select) throw new Error('citation style control not found');
  return select as HTMLSelectElement;
}

async function submit(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(screen.getByDisplayValue('A follow-up question about costs')).toBeTruthy());
  const form = document.querySelector('form');
  if (!form) throw new Error('form not found');
  fireEvent.submit(form);
  await waitFor(() => expect(mocks.startResearchSpinoff).toHaveBeenCalled());
  return mocks.startResearchSpinoff.mock.calls[0][1] as Record<string, unknown>;
}

describe('citation style on a follow-up report', () => {
  beforeEach(() => {
    mocks.fetchSpinoffPrefill.mockReset();
    mocks.startResearchSpinoff.mockReset();
    mocks.startResearchSpinoff.mockResolvedValue({ runId: 'run-2' });
  });
  afterEach(() => cleanup());

  it('opens on the report default and sends no style when the parent run had none', async () => {
    mocks.fetchSpinoffPrefill.mockResolvedValue({ query: 'A follow-up question about costs', citationStyle: null });
    renderPage();
    expect((await styleSelect()).value).toBe('automatic');
    const sent = await submit();
    expect(sent.citationStyle).toBeUndefined();
  });

  it('carries the style of the parent run', async () => {
    mocks.fetchSpinoffPrefill.mockResolvedValue({ query: 'A follow-up question about costs', citationStyle: 'mla' });
    renderPage();
    await waitFor(async () => expect((await styleSelect()).value).toBe('mla'));
    const sent = await submit();
    expect(sent.citationStyle).toBe('mla');
  });

  it('sends a style chosen here', async () => {
    mocks.fetchSpinoffPrefill.mockResolvedValue({ query: 'A follow-up question about costs', citationStyle: null });
    renderPage();
    fireEvent.change(await styleSelect(), { target: { value: 'harvard' } });
    const sent = await submit();
    expect(sent.citationStyle).toBe('harvard');
  });
});
