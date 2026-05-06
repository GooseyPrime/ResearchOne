import api, { extractApiError } from '../../utils/api';

function billingCheckoutPath(fullPath: string): string {
  return fullPath.startsWith('/api') ? fullPath.slice(4) || '/' : fullPath;
}

export async function startCheckoutRedirect(
  endpoint: '/api/billing/checkout/topup' | '/api/billing/checkout/subscription',
  body: Record<string, unknown>
): Promise<void> {
  try {
    const { data } = await api.post<{ checkoutUrl?: string }>(billingCheckoutPath(endpoint), body);
    if (data?.checkoutUrl) {
      window.location.assign(data.checkoutUrl);
      return;
    }
    throw new Error('Checkout session was not returned by the server');
  } catch (err: unknown) {
    throw new Error(extractApiError(err));
  }
}
