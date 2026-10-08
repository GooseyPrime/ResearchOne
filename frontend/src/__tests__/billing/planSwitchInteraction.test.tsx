// @vitest-environment jsdom
/**
 * The switch block's buttons, pressed for real. The rule that matters: picking
 * a plan only asks; nothing is sent until "Confirm switch" is pressed.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionOption } from '../../components/billing/PlanCheckoutOptions';
import PlanSwitchOptions, { type PendingPlanSwitch } from '../../components/billing/PlanSwitchOptions';

const PRO: SubscriptionOption = {
  tier: 'pro',
  label: 'Pro',
  monthlyPriceId: 'price_pro_m',
  annualPriceId: 'price_pro_y',
  monthlyAmountCents: 2900,
  annualAmountCents: 29000,
};
const BYOK: SubscriptionOption = { ...PRO, tier: 'byok', label: 'BYOK', monthlyPriceId: 'price_byok_m', annualPriceId: 'price_byok_y' };

/** Holds the picked plan the way the billing page does, and records what would be sent. */
function Harness({ onSend }: { onSend: (choice: PendingPlanSwitch) => void }) {
  const [pending, setPending] = useState<PendingPlanSwitch | null>(null);
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
        if (pending) onSend(pending);
      }}
      onCancel={() => setPending(null)}
      isSwitching={false}
      switchError={null}
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

    expect(screen.getByRole('alertdialog').textContent).toContain('Switch to BYOK, monthly billing?');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends the picked price only when "Confirm switch" is pressed', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: /Switch to annual/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm switch' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith({ priceId: 'price_byok_y', tier: 'byok', period: 'annual' });
  });

  it('"Keep my current plan" closes the confirmation and sends nothing', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: /Switch to monthly/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep my current plan' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('a change of billing period on the current plan carries that plan and period', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: /Change to annual/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm switch' }));

    expect(onSend).toHaveBeenCalledWith({ priceId: 'price_pro_y', tier: 'pro', period: 'annual' });
  });

  it('moves keyboard focus to the confirmation, which is described by the billing explanation', () => {
    render(<Harness onSend={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Switch to monthly/ }));

    const dialog = screen.getByRole('alertdialog');
    expect(document.activeElement).toBe(dialog);
    const detail = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(detail?.textContent).toContain('credited or charged on your next bill');
  });
});
