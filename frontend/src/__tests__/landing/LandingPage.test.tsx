import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LandingPage from '../../pages/LandingPage';

describe('LandingPage', () => {
  it('includes the approved h1, CTA labels, and sign-up funnel hrefs', () => {
    const markup = renderToString(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(markup).toContain('Research that shows its work.');
    expect(markup).toContain('Start free');
    expect(markup).toContain('See a sample report');
    expect(markup).toContain('href="/sign-up"');
    expect(markup).not.toMatch(/href="\/app\/research"/);
  });
});
