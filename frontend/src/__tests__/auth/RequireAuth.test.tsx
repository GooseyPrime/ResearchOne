import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: vi.fn(() => ({ isLoaded: true, isSignedIn: false })),
}));

import { useAuth } from '@clerk/react';
import RequireAuth from '../../components/auth/RequireAuth';

describe('RequireAuth', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ isLoaded: true, isSignedIn: false } as ReturnType<typeof useAuth>);
  });

  it('redirects signed-out users to sign-in with redirect param', () => {
    const router = createMemoryRouter(
      [{ path: '*', element: <RequireAuth><div>ok</div></RequireAuth> }],
      { initialEntries: ['/app/research'] },
    );

    const html = renderToString(<RouterProvider router={router} />);

    expect(router.state.location.pathname).toBe('/app/research');
    expect(html).not.toContain('ok');
  });

  it('renders children when authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({ isLoaded: true, isSignedIn: true } as ReturnType<typeof useAuth>);
    const router = createMemoryRouter(
      [{ path: '*', element: <RequireAuth><div>protected-content</div></RequireAuth> }],
      { initialEntries: ['/app/research'] },
    );
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain('protected-content');
  });
});
