/**
 * The "switch plan" block a Pro or BYOK subscriber sees on the billing page.
 * Picking a plan only opens a confirmation; the confirmation says in plain
 * words when the plan changes and that nothing is charged today. Once a change
 * is scheduled the block shows it, with "Keep my current plan" to take it back.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SubscriptionOption } from '../../components/billing/PlanCheckoutOptions';
import PlanSwitchOptions from '../../components/billing/PlanSwitchOptions';
import { formatPlanChangeDate, scheduledChangeSentence } from '../../lib/billing/planChange';
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
    expect(html).not.toContain('Confirm change');
    expect(html).not.toContain('role="alertdialog"');
  });

  it('says when the plan changes and that nothing is charged today, before the change is confirmed', () => {
    const html = block({
      pending: { priceId: 'price_byok_m', tier: 'byok', period: 'monthly' },
      currentPeriodEnd: '2026-11-01T12:00:00.000Z',
    });
    expect(html).toContain('Change to BYOK (monthly billing)?');
    expect(html).toContain('Your plan changes to BYOK (monthly billing) on November 1, 2026');
    expect(html).toContain('Nothing is charged today.');
    expect(html).toContain('You keep one subscription');
    expect(html).toContain('Confirm change');
    expect(html).toContain('Not now');
  });

  it('never says the change happens now, or that anything is charged or credited', () => {
    for (const html of [
      block({}),
      block({ pending: { priceId: 'price_pro_y', tier: 'pro', period: 'annual' }, currentPeriodEnd: '2026-11-01T12:00:00.000Z' }),
      block({ scheduled: { tier: 'pro', billingPeriod: 'annual', effectiveAt: '2026-11-01T12:00:00.000Z' } }),
    ]) {
      expect(html).not.toMatch(/takes effect now|credited|on your next bill|issued today|billed today|prorat/i);
      expect(html).toContain('othing is charged today');
    }
  });

  it('still says when, in words, if the end of the billing period is not known', () => {
    const html = block({ pending: { priceId: 'price_byok_m', tier: 'byok', period: 'monthly' } });
    expect(html).toContain('Your plan changes to BYOK (monthly billing) at the end of your current billing period');
  });

  it('shows a scheduled change with its date and a way to take it back, and offers no other plan', () => {
    const scheduled = { tier: 'byok' as const, billingPeriod: 'annual' as const, effectiveAt: '2026-11-01T12:00:00.000Z' };
    const html = block({ scheduled });
    expect(scheduledChangeSentence(scheduled)).toBe(
      'Your plan changes to BYOK (annual billing) on November 1, 2026. Nothing is charged today.',
    );
    expect(html).toContain('Your plan changes to BYOK (annual billing) on November 1, 2026. Nothing is charged today.');
    expect(html).toContain('Keep my current plan');
    // One change at a time: no plan button while one is pending.
    expect(html).not.toContain('data-switch-plan=');
    expect(html).not.toContain('Switch to');
    expect(html).not.toContain('Confirm change');
    expect((html.match(/<button/g) ?? [])).toHaveLength(1);
  });

  it('locks "Keep my current plan" while it is being sent, and shows why it failed', () => {
    const scheduled = { tier: 'byok' as const, billingPeriod: 'monthly' as const, effectiveAt: '2026-11-01T12:00:00.000Z' };
    const html = block({ scheduled, isKeeping: true, keepError: 'There is no scheduled plan change to cancel.' });
    expect(html).toContain('Keeping your current plan…');
    expect(html).not.toMatch(/<button(?![^>]*disabled)[^>]*>/);
    expect(html).toContain('There is no scheduled plan change to cancel.');
  });

  it('writes the date the same way everywhere, and none for a date it cannot read', () => {
    expect(formatPlanChangeDate('2026-11-01T12:00:00.000Z')).toBe('November 1, 2026');
    expect(formatPlanChangeDate(null)).toBeNull();
    expect(formatPlanChangeDate('not a date')).toBeNull();
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
    expect(html).toContain('Scheduling…');
    expect(html).not.toMatch(/<button(?![^>]*disabled)[^>]*>/);
  });

  it('uses no reader-facing jargon', () => {
    const html = block({ pending: { priceId: 'price_byok_m', tier: 'byok', period: 'monthly' } });
    expect(html.toLowerCase()).not.toContain('claims');
    expect(html.toLowerCase()).not.toContain('prorat');
  });
});
