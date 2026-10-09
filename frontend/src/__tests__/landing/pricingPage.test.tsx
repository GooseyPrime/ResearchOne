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
    expect(html).not.toContain('Team');
    expect(html).not.toMatch(/Sovereign|Enterprise|seat/i);
  });

  it('marks Student as unavailable without exposing checkout controls', () => {
    const html = render();
    // The Student plan, plus the two priced add-ons that are not sold through checkout.
    expect((html.match(/Not yet available/g) ?? [])).toHaveLength(3);
    expect(html).not.toContain('Verify and start');
    expect(html).not.toContain('inquiry →');
  });

  it('gives BYOK a Subscribe path through sign-up, then the key step', () => {
    const html = render();
    expect(html).toContain('href="/sign-up?tier=byok"');
    expect(html).toContain('href="/sign-up?tier=pro"');
    expect(html).toContain('You add your model keys right after checkout.');
    // The old card offered only a link to the BYOK explainer.
    expect(html).not.toContain('>Configure keys<');
  });

  it('gives each purchasable add-on a buy path into the app', () => {
    const html = render();
    expect(html).toMatch(/href="\/app\/billing#monitor-tokens"[^>]*>Buy tokens</);
    expect(html).toMatch(/href="\/app\/add-ons"[^>]*>Add to a report</);
  });

  it('marks priced add-ons that are not sold through checkout, with a way to ask', () => {
    const html = render();
    expect(html).toContain('Score%20API%20Pro%20inquiry');
    expect(html).toContain('Patent%20%26%20IP%20diligence%20inquiry');
  });

  it('shows add-on pricing for Living Reports and Reverse-Citation Watch', () => {
    const html = render();
    expect(html).toContain('Living Reports');
    expect(html).toContain('$10 / token');
    expect(html).toContain('Reverse-Citation Watch');
    expect(html).toContain('$15/mo');
  });

  it('marks Provenance Ledger Coming soon, with nobody to write to', () => {
    const html = render();
    expect(html).toContain('Provenance Ledger');
    expect(html).not.toContain('Provenance%20Ledger');
  });

  it("does not mention the Devil's Advocate Review", () => {
    const html = render();
    expect(html).not.toMatch(/Devil/);
    expect(html).not.toContain('Talk to sales');
    expect(html).not.toContain('/sovereign');
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
    expect(html).toContain('require an active Pro or BYOK subscription');
  });
});
