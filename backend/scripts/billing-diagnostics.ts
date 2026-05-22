/**
 * WO-Y billing integrity checks — run after migrations on Emma/dev DB.
 * Usage: cd backend && npx tsx scripts/billing-diagnostics.ts
 */
import { loadBackendEnv } from './loadBackendEnv';
import { query, queryOne } from '../src/db/pool';

loadBackendEnv();

type CountRow = { count: string };

async function scalarCount(sql: string, params: unknown[] = []): Promise<number> {
  const row = await queryOne<CountRow>(sql, params);
  return parseInt(row?.count ?? '0', 10);
}

async function main(): Promise<void> {
  const usersWithoutTier = await scalarCount(
    `SELECT COUNT(*)::text AS count FROM users u
     WHERE NOT EXISTS (SELECT 1 FROM user_tiers ut WHERE ut.user_id = u.id)`,
  );

  const paidSubFreeTier = await scalarCount(
    `SELECT COUNT(*)::text AS count
     FROM user_subscriptions us
     JOIN user_tiers ut ON ut.user_id = us.user_id
     WHERE us.status IN ('active', 'trialing', 'past_due')
       AND ut.tier = 'free_demo'`,
  );

  const subsMissingStripeId = await scalarCount(
    `SELECT COUNT(*)::text AS count FROM user_subscriptions
     WHERE status IN ('active', 'trialing', 'past_due')
       AND (stripe_subscription_id IS NULL OR stripe_subscription_id = '')`,
  );

  const duplicateStripeSubIds = await scalarCount(
    `SELECT COUNT(*)::text AS count FROM (
       SELECT stripe_subscription_id FROM user_subscriptions
       WHERE stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> ''
       GROUP BY stripe_subscription_id HAVING COUNT(*) > 1
     ) dup`,
  );

  let webhookErrors = 0;
  let multiStripeCustomers = 0;
  try {
    webhookErrors = await scalarCount(
      `SELECT COUNT(*)::text AS count FROM stripe_webhook_events
       WHERE processing_error IS NOT NULL
         AND processed_at > NOW() - INTERVAL '7 days'`,
    );
    multiStripeCustomers = await scalarCount(
      `SELECT COUNT(*)::text AS count FROM (
         SELECT user_id FROM stripe_customers GROUP BY user_id HAVING COUNT(*) > 1
       ) m`,
    );
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== '42P01' && code !== '42703') throw err;
    console.log('(stripe_webhook_events / stripe_customers tables not present — run migrations 042+)');
  }

  console.log('=== ResearchOne billing diagnostics ===\n');
  console.log(`users without user_tiers row: ${usersWithoutTier}`);
  console.log(`active/trialing/past_due subs with user_tiers.tier=free_demo: ${paidSubFreeTier}`);
  console.log(`granting subs with NULL stripe_subscription_id: ${subsMissingStripeId}`);
  console.log(`duplicate stripe_subscription_id values: ${duplicateStripeSubIds}`);
  console.log(`stripe_webhook_events with processing_error (7d): ${webhookErrors}`);
  console.log(`users with multiple stripe_customers rows: ${multiStripeCustomers}`);

  const issues =
    usersWithoutTier +
    paidSubFreeTier +
    subsMissingStripeId +
    duplicateStripeSubIds +
    webhookErrors +
    multiStripeCustomers;

  if (issues === 0) {
    console.log('\nOK — no outstanding billing integrity issues detected.');
    process.exit(0);
  }
  console.log(`\nATTENTION — ${issues} issue bucket(s) with non-zero counts.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
