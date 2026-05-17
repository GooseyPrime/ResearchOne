import { getTopupAmountForPrice } from './stripeClient';
import { creditWallet } from './walletService';
import { logger } from '../../utils/logger';

export interface CheckoutSessionTopupMetadata {
  userId?: string;
  user_id?: string;
  topupAmountCents?: string;
  price_id?: string;
}

/**
 * Credits wallet from a completed payment-mode Checkout session (idempotent per session id).
 */
export async function creditWalletFromCheckoutSession(
  sessionId: string,
  metadata: CheckoutSessionTopupMetadata,
  eventId?: string
): Promise<boolean> {
  const userId = metadata.userId ?? metadata.user_id;
  if (!userId) {
    logger.warn('stripe_checkout_missing_metadata', { eventId, sessionId });
    return false;
  }

  let amountCents: number | null = null;
  if (metadata.topupAmountCents) {
    amountCents = parseInt(metadata.topupAmountCents, 10) || null;
  } else if (metadata.price_id) {
    amountCents = getTopupAmountForPrice(metadata.price_id);
  }

  if (amountCents === null) {
    logger.warn('stripe_checkout_unknown_amount', { eventId, sessionId });
    return false;
  }

  await creditWallet({
    userId,
    amountCents,
    description: 'Wallet top-up via Stripe checkout',
    idempotencyKey: `stripe_checkout_${sessionId}`,
    stripeCheckoutSessionId: sessionId,
    metadata: { eventId, priceId: metadata.price_id },
  });
  return true;
}
