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

    expect(markup).toContain('Research that defends itself.');
    expect(markup).toContain('Open a sample report');
    expect(markup).toContain('See the methodology');
    expect(markup).toContain('href="/sign-up"');
    expect(markup).not.toMatch(/href="\/app\/research"/);
  });

  it('does not contain storage marketing language', () => {
    const markup = renderToString(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(markup).not.toContain('10 GB corpus');
    expect(markup).not.toContain('25 GB');
    expect(markup).not.toContain('50 GB shared');
  });
});
