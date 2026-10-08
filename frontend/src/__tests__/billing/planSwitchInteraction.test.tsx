// @vitest-environment jsdom
/**
 * The switch block's buttons, pressed for real. The rules that matter: picking
 * a plan only asks, and nothing is sent until "Confirm change" is pressed; a
 * confirmed change is then shown as pending, with "Keep my current plan" to
 * take it back, and no second change can be picked while it is.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionOption } from '../../components/billing/PlanCheckoutOptions';
import PlanSwitchOptions, { type PendingPlanSwitch } from '../../components/billing/PlanSwitchOptions';
import type { ScheduledPlanChange } from '../../lib/billing/planChange';

const PRO: SubscriptionOption = {
  tier: 'pro',
  label: 'Pro',
  monthlyPriceId: 'price_pro_m',
  annualPriceId: 'price_pro_y',
  monthlyAmountCents: 2900,
  annualAmountCents: 29000,
};
const BYOK: SubscriptionOption = { ...PRO, tier: 'byok', label: 'BYOK', monthlyPriceId: 'price_byok_m', annualPriceId: 'price_byok_y' };

const PERIOD_END = '2026-11-01T12:00:00.000Z';

/**
 * Holds the picked plan and the scheduled change the way the billing page
 * does, standing in for the server: a confirmed change comes back scheduled
 * for the period end, and keeping the current plan clears it.
 */
function Harness({ onSend, onKeep = () => undefined }: { onSend: (choice: PendingPlanSwitch) => void; onKeep?: () => void }) {
  const [pending, setPending] = useState<PendingPlanSwitch | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledPlanChange | null>(null);
  return (
    <PlanSwitchOptions
      currentTier="pro"
      options={[PRO, BYOK]}
      isLoading={false}
      errorMessage={null}
      onRetry={() => undefined}
      pending={pending}
      onSelect={setPending}
      onConfirm={() => {
        if (!pending) return;
        onSend(pending);
        setScheduled({ tier: pending.tier, billingPeriod: pending.period, effectiveAt: PERIOD_END });
        setPending(null);
      }}
      onCancel={() => setPending(null)}
      isSwitching={false}
      switchError={null}
      currentPeriodEnd={PERIOD_END}
      scheduled={scheduled}
      onKeepCurrentPlan={() => {
        onKeep();
        setScheduled(null);
      }}
    />
  );
}

afterEach(cleanup);

describe('PlanSwitchOptions, pressed', () => {
  it('picking a plan asks for confirmation and sends nothing', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Switch to monthly/ }));

    const dialog = screen.getByRole('alertdialog').textContent ?? '';
    expect(dialog).toContain('Change to BYOK (monthly billing)?');
    expect(dialog).toContain('on November 1, 2026');
    expect(dialog).toContain('Nothing is charged today.');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends the picked price only when "Confirm change" is pressed', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: /Switch to annual/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith({ priceId: 'price_byok_y', tier: 'byok', period: 'annual' });
  });

  it('"Not now" closes the confirmation and sends nothing', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: /Switch to monthly/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('a change of billing period on the current plan carries that plan and period', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: /Change to annual/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));

    expect(onSend).toHaveBeenCalledWith({ priceId: 'price_pro_y', tier: 'pro', period: 'annual' });
  });

  it('after confirming, says when the plan changes and that nothing is charged today', () => {
    render(<Harness onSend={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Switch to annual/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));

    expect(screen.getByRole('status').textContent).toContain(
      'Your plan changes to BYOK (annual billing) on November 1, 2026. Nothing is charged today.',
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('offers no second change while one is pending', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: /Switch to monthly/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));

    expect(screen.queryByRole('button', { name: /Switch to/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Change to/ })).toBeNull();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Keep my current plan']);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('"Keep my current plan" cancels the pending change and brings the plans back', () => {
    const onKeep = vi.fn();
    render(<Harness onSend={vi.fn()} onKeep={onKeep} />);
    fireEvent.click(screen.getByRole('button', { name: /Switch to monthly/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));

    fireEvent.click(screen.getByRole('button', { name: 'Keep my current plan' }));

    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /Switch to monthly/ })).toBeTruthy();
  });

  it('moves keyboard focus to the confirmation, which is described by the explanation of when the plan changes', () => {
    render(<Harness onSend={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Switch to monthly/ }));

    const dialog = screen.getByRole('alertdialog');
    expect(document.activeElement).toBe(dialog);
    const detail = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(detail?.textContent).toContain('Nothing is charged today.');
    expect(detail?.textContent).not.toMatch(/credited|next bill/);
  });
});
