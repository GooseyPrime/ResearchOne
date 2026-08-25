/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import ResearchPage from '../../pages/ResearchPage';

vi.mock('../../components/research/ResearchRequestForm', () => ({
  default: () => <div data-testid="research-request-form">Request form</div>,
}));

describe('ResearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the request form on the default route', () => {
    render(
      <MemoryRouter initialEntries={['/app/research']}>
        <ResearchPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId('research-request-form')).toBeTruthy();
  });

  it('redirects runId to the run workspace', () => {
    const router = createMemoryRouter(
      [
        { path: '/app/research', element: <ResearchPage /> },
        { path: '/app/run/:runId', element: <div data-testid="run-workspace">Run workspace</div> },
      ],
      { initialEntries: ['/app/research?runId=abc'] }
    );
    render(<RouterProvider router={router} />);
    expect(router.state.location.pathname).toBe('/app/run/abc');
    expect(screen.getByTestId('run-workspace')).toBeTruthy();
    expect(screen.queryByTestId('research-request-form')).toBeNull();
  });

  it('redirects a plan-review deep link to the run workspace too', () => {
    // This is the case that used to stay on this page and render an inline
    // plan gate — so which screen a user landed on depended on whether their
    // run happened to be waiting for approval when they clicked. Both halves
    // of the old fork now land in the workspace, which handles every state.
    const router = createMemoryRouter(
      [
        { path: '/app/research', element: <ResearchPage /> },
        { path: '/app/run/:runId', element: <div data-testid="run-workspace">Run workspace</div> },
      ],
      { initialEntries: ['/app/research?runId=abc&engine=v2#plan'] }
    );
    render(<RouterProvider router={router} />);
    expect(router.state.location.pathname).toBe('/app/run/abc');
    expect(screen.getByTestId('run-workspace')).toBeTruthy();
  });
});
