import type { AxiosInstance } from 'axios';
import { extractApiError } from '../../utils/api';

export async function startCheckoutRedirect(
  client: Pick<AxiosInstance, 'post'>,
  endpoint: '/billing/checkout/topup' | '/billing/checkout/subscription',
  body: Record<string, unknown>
): Promise<void> {
  try {
    const { data } = await client.post<{ checkoutUrl?: string; error?: string }>(endpoint, body);

    if (!data.checkoutUrl) {
      throw new Error(data.error || 'Checkout session was not returned by the server');
    }

    window.location.assign(data.checkoutUrl);
  } catch (err) {
    throw new Error(extractApiError(err));
  }
}
