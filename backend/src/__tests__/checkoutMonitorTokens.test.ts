import { describe, expect, it, vi, beforeEach } from 'vitest';

const { creditMonitorTokens } = vi.hoisted(() => ({
  creditMonitorTokens: vi.fn(),
}));

vi.mock('../services/billing/monitorTokenService', () => ({
  creditMonitorTokens,
}));

vi.mock('../services/billing/monitorTokenCatalog', () => ({
  resolveMonitorTokenPackage: (id: string) =>
    id === 'pack_5' ? { id: 'pack_5', tokenCount: 5 } : null,
  resolveMonitorTokenPackageByPriceId: (priceId: string) =>
    priceId === 'price_pack_5' ? { id: 'pack_5', tokenCount: 5 } : null,
}));

import { creditMonitorTokensFromCheckoutSession } from '../services/billing/checkoutMonitorTokens';

describe('creditMonitorTokensFromCheckoutSession', () => {
  beforeEach(() => {
    creditMonitorTokens.mockReset();
    creditMonitorTokens.mockResolvedValue({ applied: true, tokenBalance: 5 });
  });

  it('credits tokens from monitor_tokens metadata', async () => {
    const applied = await creditMonitorTokensFromCheckoutSession(
      'cs_test_123',
      {
        purchase_type: 'monitor_tokens',
        user_id: 'user_1',
        package_id: 'pack_5',
        token_amount: '5',
      },
      'evt_1',
    );
    expect(applied).toBe(true);
    expect(creditMonitorTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        tokenCount: 5,
        idempotencyKey: 'stripe_monitor_tokens_cs_test_123',
      }),
    );
  });

  it('returns false for unrelated purchase_type without crediting', async () => {
    const applied = await creditMonitorTokensFromCheckoutSession('cs_x', {
      purchase_type: 'wallet_topup',
      user_id: 'user_1',
    });
    expect(applied).toBe(false);
    expect(creditMonitorTokens).not.toHaveBeenCalled();
  });

  it('returns false when token amount cannot be resolved', async () => {
    const applied = await creditMonitorTokensFromCheckoutSession('cs_y', {
      purchase_type: 'monitor_tokens',
      user_id: 'user_1',
    });
    expect(applied).toBe(false);
    expect(creditMonitorTokens).not.toHaveBeenCalled();
  });
});
