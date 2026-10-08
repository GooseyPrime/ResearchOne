/**
 * The "switch plan" block a Pro or BYOK subscriber sees on the billing page.
 * Picking a plan only opens a confirmation; the confirmation says in plain
 * words what happens to the bill before anything is sent.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SubscriptionOption } from '../../components/billing/PlanCheckoutOptions';
import PlanSwitchOptions from '../../components/billing/PlanSwitchOptions';
import { isSwitchablePlan } from '../../lib/billing/planIntent';

const PRO: SubscriptionOption = {
  tier: 'pro',
  label: 'Pro',
  monthlyPriceId: 'price_pro_m',
  annualPriceId: 'price_pro_y',
  monthlyAmountCents: 2900,
  annualAmountCents: 29000,
};
const BYOK: SubscriptionOption = { ...PRO, tier: 'byok', label: 'BYOK', monthlyPriceId: 'price_byok_m', annualPriceId: 'price_byok_y' };

function block(props: Partial<Parameters<typeof PlanSwitchOptions>[0]>): string {
  return renderToStaticMarkup(
    <PlanSwitchOptions
      currentTier="pro"
      options={[PRO, BYOK]}
      isLoading={false}
      errorMessage={null}
      onRetry={vi.fn()}
      pending={null}
      onSelect={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      isSwitching={false}
      switchError={null}
      {...props}
    />,
  );
}

function planBox(html: string, tier: string): string {
  const start = html.indexOf(`data-switch-plan="${tier}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('data-switch-plan="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

describe('PlanSwitchOptions', () => {
  it('offers both plans and both billing periods, and marks the current plan', () => {
    const html = block({});
    expect(planBox(html, 'byok')).toContain('Switch to monthly ($29/mo)');
    expect(planBox(html, 'byok')).toContain('Switch to annual ($290/yr)');
    expect(planBox(html, 'pro')).toContain('Your current plan');
    expect(planBox(html, 'pro')).toContain('Change to annual');
    expect(planBox(html, 'byok')).not.toContain('Your current plan');
  });

  it('never offers Team, Student or Sovereign', () => {
    const html = block({
      options: [PRO, BYOK, { ...PRO, tier: 'team', label: 'Team' }, { ...PRO, tier: 'student', label: 'Student' }],
    });
    expect(html).not.toContain('Team');
    expect(html).not.toContain('Student');
    expect(html).not.toContain('Sovereign');
    expect(isSwitchablePlan('team')).toBe(false);
    expect(isSwitchablePlan('sovereign')).toBe(false);
    expect(isSwitchablePlan('free_demo')).toBe(false);
    expect(isSwitchablePlan(undefined)).toBe(false);
    expect(isSwitchablePlan('byok')).toBe(true);
  });

  it('shows no confirmation until a plan is picked', () => {
    const html = block({});
    expect(html).not.toContain('Confirm switch');
    expect(html).not.toContain('takes effect now');
  });

  it('says in plain words what happens to the bill before the switch is confirmed', () => {
    const html = block({ pending: { priceId: 'price_byok_m', tier: 'byok', period: 'monthly' } });
    expect(html).toContain('Switch to BYOK, monthly billing?');
    expect(html).toContain('The change takes effect now.');
    expect(html).toContain('credited or charged on your next bill');
    expect(html).toContain('You keep one subscription');
    expect(html).toContain('Confirm switch');
    expect(html).toContain('Keep my current plan');
  });

  it('says "Not yet available" for a billing period with no price instead of a dead button', () => {
    const html = block({ options: [PRO, { ...BYOK, annualPriceId: '' }] });
    expect(planBox(html, 'byok')).toContain('Switch to monthly');
    expect(planBox(html, 'byok')).not.toContain('Switch to annual');
    expect(planBox(html, 'byok')).toContain('Annual billing: </span>Not yet available');
  });

  it('shows the server’s reason when a switch is refused', () => {
    const html = block({ switchError: 'You are already on this plan and billing period.' });
    expect(html).toContain('You are already on this plan and billing period.');
  });

  it('locks the buttons while a switch is being sent', () => {
    const html = block({ isSwitching: true, pending: { priceId: 'price_byok_m', tier: 'byok', period: 'monthly' } });
    expect(html).toContain('Switching…');
    expect(html).not.toMatch(/<button(?![^>]*disabled)[^>]*>/);
  });

  it('uses no reader-facing jargon', () => {
    const html = block({ pending: { priceId: 'price_byok_m', tier: 'byok', period: 'monthly' } });
    expect(html.toLowerCase()).not.toContain('claims');
    expect(html.toLowerCase()).not.toContain('proration');
  });
});
