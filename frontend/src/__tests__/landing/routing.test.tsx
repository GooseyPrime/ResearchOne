import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: vi.fn(() => ({ isLoaded: true, isSignedIn: false })),
}));

import { useAuth } from '@clerk/react';
import App from '../../App';

describe('App routing structure', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ isLoaded: true, isSignedIn: false } as ReturnType<typeof useAuth>);
  });

  it('renders the landing page route under SSR', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Reasoning, not recall.');
  });

  it('renders the public sample report route under SSR', () => {
    const html = renderToString(<App initialEntries={['/sample-report']} />);
    expect(html).toContain('Sample research report');
  });

  it('does not render signed-in research chrome when visiting /app/research signed out', () => {
    const html = renderToString(<App initialEntries={['/app/research']} />);
    expect(html).not.toContain('Start Research');
  });
});
