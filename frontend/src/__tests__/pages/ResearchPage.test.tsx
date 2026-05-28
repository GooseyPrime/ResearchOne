/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import ResearchPage from '../../pages/ResearchPage';

vi.mock('../../pages/UnifiedResearchConsole', () => ({
  default: () => <div data-testid="unified-research-console">Unified console</div>,
  researchModeFromSearchParams: (params: URLSearchParams) =>
    params.get('engine') === 'v2' ? 'deep' : 'standard',
  applyResearchModeToSearchParams: vi.fn(),
  syncEngineQueryParam: vi.fn(),
}));

vi.mock('../../pages/ResearchStandardPage', () => ({
  default: () => <div data-testid="research-standard-page">Standard</div>,
}));

vi.mock('../../pages/ResearchDeepPage', () => ({
  default: () => <div data-testid="research-deep-page">Deep</div>,
}));

describe('ResearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders UnifiedResearchConsole on the default route', () => {
    render(
      <MemoryRouter initialEntries={['/app/research']}>
        <ResearchPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId('unified-research-console')).toBeTruthy();
  });

  it('renders Deep page for plan review deep link', () => {
    render(
      <MemoryRouter initialEntries={['/app/research?runId=abc&engine=v2#plan']}>
        <ResearchPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId('research-deep-page')).toBeTruthy();
  });

  it('redirects runId without plan hash to run detail', () => {
    const router = createMemoryRouter(
      [
        { path: '/app/research', element: <ResearchPage /> },
        { path: '/app/run/:runId', element: <div data-testid="run-detail-page">Run detail</div> },
      ],
      { initialEntries: ['/app/research?runId=abc'] }
    );
    render(<RouterProvider router={router} />);
    expect(router.state.location.pathname).toBe('/app/run/abc');
    expect(screen.getByTestId('run-detail-page')).toBeTruthy();
    expect(screen.queryByTestId('unified-research-console')).toBeNull();
  });
});
