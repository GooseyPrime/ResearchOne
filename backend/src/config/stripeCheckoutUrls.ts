const CHECKOUT_SESSION_ID_TEMPLATE = '{CHECKOUT_SESSION_ID}';

const ENCODED_CHECKOUT_SESSION_ID_TEMPLATE = encodeURIComponent(CHECKOUT_SESSION_ID_TEMPLATE);

/**
 * Stripe substitutes the literal `{CHECKOUT_SESSION_ID}` token on redirect.
 * It must not be URL-encoded — `%7B…%7D` is passed through verbatim and breaks confirm.
 */
export function appendStripeCheckoutSessionIdTemplate(url: string): string {
  let normalized = url;
  if (normalized.includes(ENCODED_CHECKOUT_SESSION_ID_TEMPLATE)) {
    normalized = normalized.replaceAll(
      ENCODED_CHECKOUT_SESSION_ID_TEMPLATE,
      CHECKOUT_SESSION_ID_TEMPLATE,
    );
  }
  if (normalized.includes(`session_id=${ENCODED_CHECKOUT_SESSION_ID_TEMPLATE}`)) {
    normalized = normalized.replace(
      `session_id=${ENCODED_CHECKOUT_SESSION_ID_TEMPLATE}`,
      `session_id=${CHECKOUT_SESSION_ID_TEMPLATE}`,
    );
  }
  if (normalized.includes(CHECKOUT_SESSION_ID_TEMPLATE)) {
    return normalized;
  }
  const joiner = normalized.includes('?') ? '&' : '?';
  return `${normalized}${joiner}session_id=${CHECKOUT_SESSION_ID_TEMPLATE}`;
}

/**
 * Stripe Checkout success URL must include Stripe's session id template so the
 * confirm endpoint can reconcile entitlement on return (WO-Y).
 *
 * @deprecated Prefer {@link appendStripeCheckoutSessionIdTemplate} via
 * `resolveStripeCheckoutRedirect` — production envs missing the template are
 * normalized instead of failing boot/migrate.
 */
export function assertStripeCheckoutSuccessUrlHasSessionTemplate(
  url: string,
  envName: string,
  nodeEnv: string,
): void {
  if (nodeEnv !== 'production') return;
  if (!url.includes(CHECKOUT_SESSION_ID_TEMPLATE)) {
    throw new Error(
      `${envName} must include "${CHECKOUT_SESSION_ID_TEMPLATE}" in production (see backend/.env.production.example)`,
    );
  }
}

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

  if (envName === 'STRIPE_CHECKOUT_SUCCESS_URL') {
    return appendStripeCheckoutSessionIdTemplate(trimmed);
  }

  return trimmed;
}
