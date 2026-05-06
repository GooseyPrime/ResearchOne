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
  if (priceId === config.stripe.priceIds.wallet20) return 2000;
  if (priceId === config.stripe.priceIds.wallet50) return 5000;
  if (priceId === config.stripe.priceIds.wallet100) return 10000;
  return null;
}
