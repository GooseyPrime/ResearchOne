export async function startCheckoutRedirect(
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  endpoint: '/api/billing/checkout/topup' | '/api/billing/checkout/subscription',
  body: Record<string, unknown>
): Promise<void> {
  const response = await authedFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || 'Could not start checkout');
  }

  const payload = (await response.json()) as { checkoutUrl?: string };
  if (payload.checkoutUrl) {
    window.location.assign(payload.checkoutUrl);
    return;
  }

  throw new Error('Checkout session was not returned by the server');
}
