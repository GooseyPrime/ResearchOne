/**
 * Stripe Checkout success/cancel URLs must match Dashboard allow-list entries.
 * Production refuses localhost fallbacks so VM deploys cannot silently redirect users to dev URLs.
 */
export function resolveStripeCheckoutRedirect(
  raw: string | undefined,
  envName: string,
  nodeEnv: string,
  devDefault: string,
): string {
  const trimmed = (raw ?? '').trim();
  if (nodeEnv !== 'production') {
    return trimmed || devDefault;
  }

  if (!trimmed) {
    throw new Error(
      `${envName} must be set in production to an https URL registered in the Stripe Dashboard (see backend/.env.production.example)`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${envName} must be a valid absolute URL`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${envName} must use https in production`);
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw new Error(`${envName} cannot use localhost in production`);
  }

  return trimmed;
}
