import api, { extractApiError } from '../../utils/api';

export async function startCheckoutRedirect(
  endpoint: '/billing/checkout/topup' | '/billing/checkout/subscription',
  body: Record<string, unknown>
): Promise<void> {
  try {
    const { data } = await api.post<{ checkoutUrl?: string; error?: string }>(endpoint, body);
    if (data?.checkoutUrl) {
      window.location.assign(data.checkoutUrl);
      return;
    }
    throw new Error(data?.error || 'Checkout session was not returned by the server');
  } catch (err: unknown) {
    throw new Error(extractApiError(err));
  }
}
