import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LandingPage from '../../pages/LandingPage';

describe('LandingPage', () => {
  it('includes the Sticklight hero, CTA labels, and sign-up funnel hrefs', () => {
    const markup = renderToString(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(markup).toContain('Research that');
    expect(markup).toContain('maps');
    expect(markup).toContain('Start Research');
    expect(markup).toContain('View Sample Report');
    expect(markup).toContain('href="/sign-up"');
    expect(markup).toContain('href="/sample-report"');
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
