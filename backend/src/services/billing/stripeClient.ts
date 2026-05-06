import Stripe from 'stripe';
import { config } from '../../config';

let stripeClient: InstanceType<typeof Stripe> | null = null;

export function getStripeClient(): InstanceType<typeof Stripe> {
  if (!config.stripe.secretKey) {
    throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is missing');
  }
  if (!stripeClient) {
    stripeClient = new Stripe(config.stripe.secretKey);
  }
  return stripeClient;
}

export function getTopupAmountForPrice(priceId: string): number | null {
  const ids = config.stripe.priceIds;
  if (!priceId.trim()) return null;
  if (ids.wallet20 && priceId === ids.wallet20) return 2000;
  if (ids.wallet50 && priceId === ids.wallet50) return 5000;
  if (ids.wallet100 && priceId === ids.wallet100) return 10000;
  return null;
}
