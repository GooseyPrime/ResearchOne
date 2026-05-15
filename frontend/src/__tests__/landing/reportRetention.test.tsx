import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: vi.fn(() => ({ isLoaded: true, isSignedIn: true, userId: 'user_ssr_test' })),
}));

vi.mock('../../hooks/useDossiers', () => ({
  useDossiers: vi.fn(() => ({
    data: { rows: [], total: 0, page: 1, pageSize: 50 },
    isLoading: false,
    isError: false,
    error: null,
  })),
}));

import { useAuth } from '@clerk/react';
import DossiersPage from '../../pages/DossiersPage';

function render() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DossiersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DossiersPage — retention rendering (replaces legacy Reports library)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      userId: 'user_ssr_test',
    } as ReturnType<typeof useAuth>);
  });

  it('renders the Dossiers list shell without crashing', () => {
    const html = render();
    expect(html).toContain('Dossiers');
  });

  it('compiles with format import from date-fns (no runtime error)', () => {
    const html = render();
    expect(html).toBeDefined();
    expect(html.length).toBeGreaterThan(0);
  });
});
