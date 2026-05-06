import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: vi.fn(() => ({ isLoaded: true, isSignedIn: false })),
}));

import RequireAuth from '../../components/auth/RequireAuth';

describe('RequireAuth', () => {
  it('redirects signed-out users to sign-in with redirect param', () => {
    const router = createMemoryRouter(
      [{ path: '*', element: <RequireAuth><div>ok</div></RequireAuth> }],
      { initialEntries: ['/app/research'] },
    );

    renderToString(<RouterProvider router={router} />);

    expect(router.state.location.pathname).toBe('/sign-in');
    expect(router.state.location.search).toContain('redirect=%2Fapp%2Fresearch');
  });
});
