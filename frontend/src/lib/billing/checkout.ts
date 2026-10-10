import api, { extractApiError } from '../../utils/api';
import { trackBeginCheckout, type CheckoutItem } from '../analyticsEvents';

const STRIPE_CHECKOUT_SESSION_PLACEHOLDER = '{CHECKOUT_SESSION_ID}';

/** Stripe return query param; rejects unreplaced template from mis-encoded success_url. */
export function parseStripeCheckoutReturnSessionId(raw: string | null): string | null {
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  if (
    decoded === STRIPE_CHECKOUT_SESSION_PLACEHOLDER
    || decoded.includes('CHECKOUT_SESSION_ID')
  ) {
    return null;
  }
  return decoded;
}

export async function startMonitorTokenCheckoutRedirect(packageId: string, item?: CheckoutItem): Promise<void> {
  try {
    const { data } = await api.post<{ checkoutUrl?: string; error?: string }>(
      '/billing/monitor-tokens/checkout',
      { packageId },
    );
    if (data?.checkoutUrl) {
      const url = new URL(data.checkoutUrl);
      if (item) trackBeginCheckout(item);
      window.location.assign(url.toString());
      return;
    }
    throw new Error(data?.error || 'Checkout session was not returned by the server');
  } catch (err: unknown) {
    throw new Error(extractApiError(err));
  }
}

export async function startCheckoutRedirect(
  endpoint: '/billing/checkout/topup' | '/billing/checkout/subscription',
  body: Record<string, unknown>,
  /** What is being bought, for the checkout-started count. Never a person or a request. */
  item?: CheckoutItem,
): Promise<void> {
  try {
    const { data } = await api.post<{ checkoutUrl?: string; error?: string }>(endpoint, body);
    if (data?.checkoutUrl) {
      if (item) trackBeginCheckout(item);
      window.location.assign(data.checkoutUrl);
      return;
    }
    throw new Error(data?.error || 'Checkout session was not returned by the server');
  } catch (err: unknown) {
    throw new Error(extractApiError(err));
  }
}
