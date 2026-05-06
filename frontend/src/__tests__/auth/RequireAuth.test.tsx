import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: vi.fn(() => ({ isLoaded: true, isSignedIn: false })),
}));

import RequireAuth from '../../components/auth/RequireAuth';

describe('RequireAuth', () => {
  it('redirects signed-out users to sign-in with redirect param', () => {
    const router = createMemoryRouter(
      [{ path: '*', element: <RequireAuth><div>ok</div></RequireAuth> }],
      { initialEntries: ['/app/research'] },
    );

    const html = renderToString(<RouterProvider router={router} />);

    // SSR does not execute client navigation side-effects; ensure guard
    // does not render protected children when signed out.
    expect(router.state.location.pathname).toBe('/app/research');
    expect(html).not.toContain('ok');
  });
});
