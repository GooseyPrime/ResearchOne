import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import PricingPage from '../../pages/PricingPage';

function render() {
  return renderToString(
    <MemoryRouter>
      <PricingPage />
    </MemoryRouter>
  );
}

describe('PricingPage', () => {
  it('shows free demo lifetime cap of 2 reports', () => {
    const html = render();
    expect(html).toContain('2 reports lifetime');
  });

  it('shows available plans and clearly labels deferred tiers', () => {
    const html = render();
    expect(html).toContain('Free Demo');
    expect(html).toContain('Student');
    expect(html).toContain('Pro');
    expect(html).toContain('BYOK');
    expect(html).toContain('Team');
    expect(html).toContain('Sovereign Enterprise');
  });

  it('marks Student and Team as unavailable instead of exposing checkout controls', () => {
    const html = render();
    expect((html.match(/Not yet available/g) ?? [])).toHaveLength(2);
    expect(html).not.toContain('Verify and start');
    expect(html).not.toContain('Team%20tier%20inquiry');
  });

  it('shows add-on pricing for Living Reports and Reverse-Citation Watch', () => {
    const html = render();
    expect(html).toContain('Living Reports');
    expect(html).toContain('$10 / token');
    expect(html).toContain('Reverse-Citation Watch');
    expect(html).toContain('$15/mo');
  });

  it('marks Provenance Ledger Coming soon with Contact us', () => {
    const html = render();
    expect(html).toContain('Provenance Ledger');
    expect(html).toContain('Provenance%20Ledger');
  });

  it("mentions Devil's Advocate Review as Sovereign-only", () => {
    const html = render();
    expect(html).toContain('Devil&#x27;s Advocate Review');
    expect(html).toContain('Included in Sovereign');
  });

  it('shows wallet credit pricing tiers', () => {
    const html = render();
    expect(html).toContain('$20');
    expect(html).toContain('$50');
    expect(html).toContain('$100');
    expect(html).toContain('$4 per Standard');
    expect(html).toContain('$10 per Deep');
  });

  it('explains the add-on dependency invariant', () => {
    const html = render();
    expect(html).toContain('require an active Pro, BYOK, Team, or Sovereign');
  });
});
