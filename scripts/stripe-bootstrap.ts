#!/usr/bin/env -S npx tsx
/**
 * stripe-bootstrap.ts — Idempotent Stripe product/price setup for ResearchOne
 *
 * Creates all Stripe products and prices. Products are deduped via
 * metadata['lookup_key'] + Stripe search; prices use the Stripe lookup_key field.
 * On success, outputs the STRIPE_PRICE_ID_* environment variable block.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... npx ts-node scripts/stripe-bootstrap.ts
 *
 * Products created:
 *   - ResearchOne Student (monthly + annual)
 *   - ResearchOne Pro (monthly + annual)
 *   - ResearchOne Team Seat (monthly + annual)
 *   - ResearchOne BYOK (monthly + annual)
 *   - Wallet Top-up ($20, $50, $100)
 *   - Living Reports
 *   - Reverse-Citation Watch
 *   - Adversarial Twin
 *   - Provenance Ledger
 *   - PolicyOne Score API Pro
 *   - Patent IP Diligence Floor
 *   - Sovereign Onboarding
 *   - Sovereign Add-ons (Custom Corpus Adapter, Custom Model Weights, Priority SLA, Dedicated Success)
 */

import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error('Error: STRIPE_SECRET_KEY environment variable is required');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

interface ProductSpec {
  name: string;
  description: string;
  lookupKey: string;
}

interface PriceSpec {
  productLookupKey: string;
  lookupKey: string;
  unitAmountCents: number;
  currency: string;
  recurring?: {
    interval: 'month' | 'year';
  };
}

const PRODUCTS: ProductSpec[] = [
  { name: 'ResearchOne — Student', description: 'Student tier subscription (SheerID-verified)', lookupKey: 'researchone_student' },
  { name: 'ResearchOne — Pro', description: 'Pro tier subscription for indie researchers and consultants', lookupKey: 'researchone_pro' },
  { name: 'ResearchOne — Team Seat', description: 'Team tier subscription per seat (3-seat minimum)', lookupKey: 'researchone_team_seat' },
  { name: 'ResearchOne — BYOK', description: 'Bring Your Own Keys subscription', lookupKey: 'researchone_byok' },
  { name: 'ResearchOne — Wallet Top-up ($20)', description: 'One-time wallet top-up. Wallet credits do not expire. Used for pay-per-report pricing ($4 Standard, $10 Deep) and Pro-tier overages.', lookupKey: 'researchone_wallet_topup_20' },
  { name: 'ResearchOne — Wallet Top-up ($50)', description: 'One-time wallet top-up. Wallet credits do not expire. Used for pay-per-report pricing ($4 Standard, $10 Deep) and Pro-tier overages.', lookupKey: 'researchone_wallet_topup_50' },
  { name: 'ResearchOne — Wallet Top-up ($100)', description: 'One-time wallet top-up. Wallet credits do not expire. Used for pay-per-report pricing ($4 Standard, $10 Deep) and Pro-tier overages.', lookupKey: 'researchone_wallet_topup_100' },
  { name: 'ResearchOne — Living Reports', description: 'Continuous monitoring and updates for published reports', lookupKey: 'researchone_living_reports' },
  { name: 'ResearchOne — Reverse-Citation Watch', description: 'Track when your research is cited or referenced', lookupKey: 'researchone_reverse_citation_watch' },
  { name: 'ResearchOne — Adversarial Twin', description: 'Dedicated adversarial analysis service', lookupKey: 'researchone_adversarial_twin' },
  { name: 'ResearchOne — Provenance Ledger', description: 'Immutable audit trail for research provenance', lookupKey: 'researchone_provenance_ledger' },
  { name: 'ResearchOne — PolicyOne Score API Pro', description: 'API access to PolicyOne compliance scoring', lookupKey: 'researchone_policyone_api_pro' },
  { name: 'ResearchOne — Patent IP Diligence Floor', description: 'Base fee for patent and IP diligence analysis', lookupKey: 'researchone_patent_ip_floor' },
  { name: 'ResearchOne — Sovereign Onboarding', description: 'One-time onboarding fee for Sovereign tier', lookupKey: 'researchone_sovereign_onboarding' },
  { name: 'ResearchOne — Sovereign: Custom Corpus Adapter', description: 'Custom corpus ingestion adapter for Sovereign clients', lookupKey: 'researchone_sovereign_corpus_adapter' },
  { name: 'ResearchOne — Sovereign: Custom Model Weights', description: 'Custom model weights integration for Sovereign clients', lookupKey: 'researchone_sovereign_custom_weights' },
  { name: 'ResearchOne — Sovereign: Priority Response SLA', description: 'Priority response SLA add-on for Sovereign clients', lookupKey: 'researchone_sovereign_priority_sla' },
  { name: 'ResearchOne — Sovereign: Dedicated Success', description: 'Dedicated success contact add-on for Sovereign clients', lookupKey: 'researchone_sovereign_dedicated_success' },
];

const PRICES: PriceSpec[] = [
  // Student tier: $9/month, $90/year (17% annual discount)
  { productLookupKey: 'researchone_student', lookupKey: 'student_monthly', unitAmountCents: 900, currency: 'usd', recurring: { interval: 'month' } },
  { productLookupKey: 'researchone_student', lookupKey: 'student_annual', unitAmountCents: 9000, currency: 'usd', recurring: { interval: 'year' } },

  // Pro tier: $29/month, $290/year
  { productLookupKey: 'researchone_pro', lookupKey: 'pro_monthly', unitAmountCents: 2900, currency: 'usd', recurring: { interval: 'month' } },
  { productLookupKey: 'researchone_pro', lookupKey: 'pro_annual', unitAmountCents: 29000, currency: 'usd', recurring: { interval: 'year' } },

  // Team tier: $99/seat/month, $990/seat/year
  { productLookupKey: 'researchone_team_seat', lookupKey: 'team_seat_monthly', unitAmountCents: 9900, currency: 'usd', recurring: { interval: 'month' } },
  { productLookupKey: 'researchone_team_seat', lookupKey: 'team_seat_annual', unitAmountCents: 99000, currency: 'usd', recurring: { interval: 'year' } },

  // BYOK tier: $29/month, $290/year
  { productLookupKey: 'researchone_byok', lookupKey: 'byok_monthly', unitAmountCents: 2900, currency: 'usd', recurring: { interval: 'month' } },
  { productLookupKey: 'researchone_byok', lookupKey: 'byok_annual', unitAmountCents: 29000, currency: 'usd', recurring: { interval: 'year' } },

  // Wallet top-ups (one-time, one product per denomination)
  { productLookupKey: 'researchone_wallet_topup_20', lookupKey: 'wallet_topup_20', unitAmountCents: 2000, currency: 'usd' },
  { productLookupKey: 'researchone_wallet_topup_50', lookupKey: 'wallet_topup_50', unitAmountCents: 5000, currency: 'usd' },
  { productLookupKey: 'researchone_wallet_topup_100', lookupKey: 'wallet_topup_100', unitAmountCents: 10000, currency: 'usd' },

  // Add-on services (monthly recurring)
  { productLookupKey: 'researchone_living_reports', lookupKey: 'living_reports_monthly', unitAmountCents: 1900, currency: 'usd', recurring: { interval: 'month' } },
  { productLookupKey: 'researchone_reverse_citation_watch', lookupKey: 'reverse_citation_watch_monthly', unitAmountCents: 1500, currency: 'usd', recurring: { interval: 'month' } },
  { productLookupKey: 'researchone_adversarial_twin', lookupKey: 'adversarial_twin_monthly', unitAmountCents: 4900, currency: 'usd', recurring: { interval: 'month' } },
  { productLookupKey: 'researchone_provenance_ledger', lookupKey: 'provenance_ledger_monthly', unitAmountCents: 2900, currency: 'usd', recurring: { interval: 'month' } },
  { productLookupKey: 'researchone_policyone_api_pro', lookupKey: 'policyone_api_pro_monthly', unitAmountCents: 9900, currency: 'usd', recurring: { interval: 'month' } },

  // Patent IP Diligence floor (one-time per engagement)
  { productLookupKey: 'researchone_patent_ip_floor', lookupKey: 'patent_ip_floor', unitAmountCents: 250000, currency: 'usd' },

  // Sovereign Onboarding (one-time)
  { productLookupKey: 'researchone_sovereign_onboarding', lookupKey: 'sovereign_onboarding', unitAmountCents: 750000, currency: 'usd' },

  // Sovereign add-ons (one-time or as invoiced)
  { productLookupKey: 'researchone_sovereign_corpus_adapter', lookupKey: 'sovereign_corpus_adapter', unitAmountCents: 250000, currency: 'usd' },
  { productLookupKey: 'researchone_sovereign_custom_weights', lookupKey: 'sovereign_custom_weights', unitAmountCents: 500000, currency: 'usd' },
  { productLookupKey: 'researchone_sovereign_priority_sla', lookupKey: 'sovereign_priority_sla_monthly', unitAmountCents: 150000, currency: 'usd', recurring: { interval: 'month' } },
  { productLookupKey: 'researchone_sovereign_dedicated_success', lookupKey: 'sovereign_dedicated_success_monthly', unitAmountCents: 200000, currency: 'usd', recurring: { interval: 'month' } },
];

async function findOrCreateProduct(spec: ProductSpec): Promise<string> {
  const existing = await stripe.products.search({
    query: `metadata['lookup_key']:'${spec.lookupKey}'`,
  });

  if (existing.data.length > 0) {
    console.log(`  ✓ Product exists: ${spec.name}`);
    return existing.data[0].id;
  }

  const product = await stripe.products.create({
    name: spec.name,
    description: spec.description,
    metadata: { lookup_key: spec.lookupKey },
  });
  console.log(`  + Created product: ${spec.name}`);
  return product.id;
}

async function findOrCreatePrice(spec: PriceSpec, productIdMap: Map<string, string>): Promise<{ lookupKey: string; priceId: string }> {
  const productId = productIdMap.get(spec.productLookupKey);
  if (!productId) {
    throw new Error(`Product not found for lookup key: ${spec.productLookupKey}`);
  }

  const existing = await stripe.prices.list({
    product: productId,
    lookup_keys: [spec.lookupKey],
  });

  if (existing.data.length > 0) {
    console.log(`  ✓ Price exists: ${spec.lookupKey}`);
    return { lookupKey: spec.lookupKey, priceId: existing.data[0].id };
  }

  const priceParams: Stripe.PriceCreateParams = {
    product: productId,
    unit_amount: spec.unitAmountCents,
    currency: spec.currency,
    lookup_key: spec.lookupKey,
  };

  if (spec.recurring) {
    priceParams.recurring = { interval: spec.recurring.interval };
  }

  const price = await stripe.prices.create(priceParams);
  console.log(`  + Created price: ${spec.lookupKey}`);
  return { lookupKey: spec.lookupKey, priceId: price.id };
}

const ENV_VAR_OVERRIDES: Record<string, string> = {
  wallet_topup_20: 'STRIPE_PRICE_ID_WALLET_20',
  wallet_topup_50: 'STRIPE_PRICE_ID_WALLET_50',
  wallet_topup_100: 'STRIPE_PRICE_ID_WALLET_100',
};

function toEnvVarName(lookupKey: string): string {
  return ENV_VAR_OVERRIDES[lookupKey] ?? `STRIPE_PRICE_ID_${lookupKey.toUpperCase()}`;
}

async function main() {
  console.log('ResearchOne Stripe Bootstrap');
  console.log('============================\n');

  console.log('Creating products...');
  const productIdMap = new Map<string, string>();
  for (const spec of PRODUCTS) {
    const productId = await findOrCreateProduct(spec);
    productIdMap.set(spec.lookupKey, productId);
  }
  console.log();

  console.log('Creating prices...');
  const priceResults: Array<{ lookupKey: string; priceId: string }> = [];
  for (const spec of PRICES) {
    const result = await findOrCreatePrice(spec, productIdMap);
    priceResults.push(result);
  }
  console.log();

  console.log('Environment variables (add to .env):');
  console.log('=====================================');
  for (const { lookupKey, priceId } of priceResults) {
    console.log(`${toEnvVarName(lookupKey)}=${priceId}`);
  }
  console.log();

  console.log('Bootstrap complete.');
}

main().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
