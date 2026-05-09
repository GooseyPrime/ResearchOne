import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import PricingPage from '../../pages/PricingPage';

function render() {
  return renderToString(
    <MemoryRouter>
      <PricingPage />
    </MemoryRouter>,
  );
}

describe('PricingPage — no storage language', () => {
  it('does not contain "GB" in rendered output', () => {
    const html = render();
    expect(html).not.toMatch(/\bGB\b/);
  });

  it('does not contain "storage" (case insensitive)', () => {
    const html = render();
    expect(html.toLowerCase()).not.toContain('storage');
  });

  it('does not contain "10 GB corpus"', () => {
    const html = render();
    expect(html).not.toContain('10 GB corpus');
  });

  it('does not contain "25 GB"', () => {
    const html = render();
    expect(html).not.toContain('25 GB');
  });

  it('does not contain "50 GB shared"', () => {
    const html = render();
    expect(html).not.toContain('50 GB shared');
  });

  it('still contains paid tier CTAs', () => {
    const html = render();
    expect(html).toContain('Subscribe');
    expect(html).toContain('Start free');
  });
});
