-- Backfill user_tiers for users missing rows; reconcile paid subscriptions stuck on free_demo.

INSERT INTO user_tiers (user_id, tier, current_period_resets_at, updated_at)
SELECT u.id, 'free_demo',
       date_trunc('month', NOW()) + INTERVAL '1 month',
       NOW()
FROM users u
LEFT JOIN user_tiers ut ON ut.user_id = u.id
WHERE ut.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

UPDATE user_tiers ut
SET tier = us.tier, updated_at = NOW()
FROM user_subscriptions us
WHERE ut.user_id = us.user_id
  AND ut.tier = 'free_demo'
  AND us.tier <> 'free_demo'
  AND us.status IN ('active', 'trialing', 'past_due');
