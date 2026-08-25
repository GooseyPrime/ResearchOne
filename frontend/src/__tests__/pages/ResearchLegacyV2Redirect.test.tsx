/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import ResearchLegacyV2Redirect from '../../pages/ResearchLegacyV2Redirect';

describe('ResearchLegacyV2Redirect', () => {
  it('preserves the legacy query string and hash', () => {
    const router = createMemoryRouter(
      [
        { path: '/app/research-v2', element: <ResearchLegacyV2Redirect /> },
        { path: '/app/research', element: <div data-testid="research-page">Research page</div> },
      ],
      { initialEntries: ['/app/research-v2?runId=abc#plan'] }
    );

    render(<RouterProvider router={router} />);

    expect(router.state.location.pathname).toBe('/app/research');
    expect(router.state.location.search).toBe('?runId=abc');
    expect(router.state.location.hash).toBe('#plan');
    expect(screen.getByTestId('research-page')).toBeTruthy();
  });
});
