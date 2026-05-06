import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from '../../App';

function AppWithLocationProbe() {
  const location = useLocation();

  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <App />
    </>
  );
}

describe('App routing structure', () => {
  it('routes / to LandingPage and redirects /app to /app/research', () => {
    const landingRouter = createMemoryRouter(
      [{ path: '*', element: <AppWithLocationProbe /> }],
      { initialEntries: ['/'] },
    );

    const landingHtml = renderToString(<RouterProvider router={landingRouter} />);

    expect(landingRouter.state.location.pathname).toBe('/');
    expect(landingHtml).toContain('data-testid="location">/</div>');

    const appRouter = createMemoryRouter(
      [{ path: '*', element: <AppWithLocationProbe /> }],
      { initialEntries: ['/app'] },
    );

    renderToString(<RouterProvider router={appRouter} />);

    expect(appRouter.state.location.pathname).toBe('/app/research');
  });
});
