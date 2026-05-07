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

export function getTierForSubscriptionPrice(priceId: string): string | null {
  const ids = config.stripe.priceIds;
  if (!priceId.trim()) return null;
  if ((ids.studentMonthly && priceId === ids.studentMonthly) || (ids.studentAnnual && priceId === ids.studentAnnual)) {
    return 'student';
  }
  if ((ids.proMonthly && priceId === ids.proMonthly) || (ids.proAnnual && priceId === ids.proAnnual)) {
    return 'pro';
  }
  if ((ids.teamSeatMonthly && priceId === ids.teamSeatMonthly) || (ids.teamSeatAnnual && priceId === ids.teamSeatAnnual)) {
    return 'team';
  }
  if ((ids.byokMonthly && priceId === ids.byokMonthly) || (ids.byokAnnual && priceId === ids.byokAnnual)) {
    return 'byok';
  }
  return null;
}

export interface SubscriptionPriceOption {
  tier: string;
  label: string;
  monthlyPriceId: string;
  annualPriceId: string;
  monthlyAmountCents: number;
  annualAmountCents: number;
}

export function getSubscriptionPriceOptions(): SubscriptionPriceOption[] {
  const ids = config.stripe.priceIds;
  const options: SubscriptionPriceOption[] = [];

  if (ids.studentMonthly || ids.studentAnnual) {
    options.push({
      tier: 'student',
      label: 'Student',
      monthlyPriceId: ids.studentMonthly,
      annualPriceId: ids.studentAnnual,
      monthlyAmountCents: 900,
      annualAmountCents: 9000,
    });
  }

  if (ids.proMonthly || ids.proAnnual) {
    options.push({
      tier: 'pro',
      label: 'Pro',
      monthlyPriceId: ids.proMonthly,
      annualPriceId: ids.proAnnual,
      monthlyAmountCents: 2900,
      annualAmountCents: 29000,
    });
  }

  if (ids.teamSeatMonthly || ids.teamSeatAnnual) {
    options.push({
      tier: 'team',
      label: 'Team Seat',
      monthlyPriceId: ids.teamSeatMonthly,
      annualPriceId: ids.teamSeatAnnual,
      monthlyAmountCents: 9900,
      annualAmountCents: 99000,
    });
  }

  if (ids.byokMonthly || ids.byokAnnual) {
    options.push({
      tier: 'byok',
      label: 'BYOK',
      monthlyPriceId: ids.byokMonthly,
      annualPriceId: ids.byokAnnual,
      monthlyAmountCents: 2900,
      annualAmountCents: 29000,
    });
  }

  return options;
}
