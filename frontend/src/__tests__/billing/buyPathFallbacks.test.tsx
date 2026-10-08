/**
 * The signed-in billing page blocks: a plan or token pack whose Stripe price
 * is not set shows "Not yet available" where its button would be, and never
 * an empty area.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PlanCheckoutOptions, { type SubscriptionOption } from '../../components/billing/PlanCheckoutOptions';
import MonitorTokenPurchaseOptions from '../../components/billing/MonitorTokenPurchaseOptions';

const PRO: SubscriptionOption = {
  tier: 'pro',
  label: 'Pro',
  monthlyPriceId: 'price_pro_m',
  annualPriceId: 'price_pro_y',
  monthlyAmountCents: 2900,
  annualAmountCents: 29000,
};
const BYOK: SubscriptionOption = { ...PRO, tier: 'byok', label: 'BYOK', monthlyPriceId: 'price_byok_m', annualPriceId: '' };

function plans(props: Partial<Parameters<typeof PlanCheckoutOptions>[0]>): string {
  return renderToStaticMarkup(
    <PlanCheckoutOptions
      options={[]}
      isLoading={false}
      errorMessage={null}
      onRetry={vi.fn()}
      onCheckout={vi.fn()}
      {...props}
    />,
  );
}

/** Markup of one plan's box. */
function planBox(html: string, tier: string): string {
  const start = html.indexOf(`data-plan="${tier}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('data-plan="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

describe('PlanCheckoutOptions', () => {
  it('shows both plans as "Not yet available" when the server offers none (missing Pro price)', () => {
    const html = plans({ options: [] });
    expect(html).toContain('Pro');
    expect(html).toContain('BYOK');
    expect(html.match(/Not yet available/g) ?? []).toHaveLength(2);
    expect(html).not.toContain('<button');
  });

  it('shows buttons for a configured plan and the note for the other', () => {
    const html = plans({ options: [BYOK] });
    expect(planBox(html, 'byok')).toContain('Monthly');
    expect(planBox(html, 'byok')).not.toContain('Not yet available');
    expect(planBox(html, 'pro')).toContain('Not yet available');
    expect(planBox(html, 'pro')).not.toContain('<button');
  });

  it('offers only the billing periods that have a price', () => {
    const html = plans({ options: [PRO, BYOK] });
    expect(planBox(html, 'pro')).toContain('Monthly');
    expect(planBox(html, 'pro')).toContain('Annual');
    expect(planBox(html, 'byok')).toContain('Monthly');
    expect(planBox(html, 'byok')).not.toContain('Annual');
    expect(html).not.toContain('Not yet available');
  });

  it('treats an option with no price ids as not available', () => {
    const html = plans({ options: [{ ...PRO, monthlyPriceId: '', annualPriceId: '' }] });
    expect(planBox(html, 'pro')).toContain('Not yet available');
  });

  it('shows the plan prices even when the plan cannot be bought yet', () => {
    const html = plans({ options: [] });
    expect(planBox(html, 'byok')).toContain('$29/mo');
  });

  it('puts the plan chosen on the pricing page first', () => {
    const html = plans({ options: [PRO, BYOK], highlightTier: 'byok' });
    expect(html.indexOf('data-plan="byok"')).toBeLessThan(html.indexOf('data-plan="pro"'));
  });

  it('offers a retry instead of an empty area when plans fail to load', () => {
    const html = plans({ errorMessage: 'Server error' });
    expect(html).toContain('Could not load plans.');
    expect(html).toContain('Retry');
  });
});

function tokens(props: Partial<Parameters<typeof MonitorTokenPurchaseOptions>[0]>): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MonitorTokenPurchaseOptions packages={[]} isLoading={false} eligible onBuy={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

const PACKS = [
  { id: 'pack_1', label: '1 token — $10' },
  { id: 'pack_5', label: '5 tokens — $25' },
  { id: 'pack_10', label: '10 tokens — $40' },
];

describe('MonitorTokenPurchaseOptions', () => {
  it('shows "Not yet available" when no token pack is priced', () => {
    const html = tokens({ packages: [] });
    expect(html).toContain('Not yet available');
    expect(html).not.toContain('<button');
  });

  it('shows one button per priced pack to an eligible subscriber', () => {
    const html = tokens({ packages: PACKS });
    expect(html.match(/<button/g) ?? []).toHaveLength(3);
    expect(html).toContain('5 tokens — $25');
    expect(html).not.toContain('Not yet available');
  });

  it('shows the plan requirement, not buttons, to a user without an eligible plan', () => {
    const html = tokens({ packages: PACKS, eligible: false });
    expect(html).not.toContain('<button');
    expect(html).toContain('require an active Pro, BYOK, Team, or Sovereign subscription');
    expect(html).toContain('href="/app/billing?intent=pro"');
  });
});
