import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import ReportsPage from '../../pages/ReportsPage';

function render() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReportsPage — retention rendering', () => {
  it('renders the ReportsPage without crashing', () => {
    const html = render();
    expect(html).toContain('Report Library');
  });

  it('compiles with format import from date-fns (no runtime error)', () => {
    const html = render();
    expect(html).toBeDefined();
    expect(html.length).toBeGreaterThan(0);
  });
});
