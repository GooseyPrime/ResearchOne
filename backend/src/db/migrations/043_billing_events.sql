CREATE TABLE IF NOT EXISTS billing_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_event_id TEXT UNIQUE,
  stripe_invoice_id TEXT,
  stripe_subscription_id TEXT,
  stripe_checkout_session_id TEXT,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'subscription_started',
    'subscription_renewed',
    'subscription_updated',
    'subscription_canceled',
    'invoice_paid',
    'invoice_payment_failed',
    'addon_started',
    'addon_canceled'
  )),
  tier TEXT,
  addon_kind TEXT,
  amount_cents BIGINT,
  currency TEXT,
  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_user_occurred
  ON billing_events(user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_stripe_event_id
  ON billing_events(stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    EXECUTE 'ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'billing_events' AND policyname = 'billing_events_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY billing_events_user_isolation ON billing_events
        FOR ALL TO application_role
        USING (user_id = current_setting('app.user_id', true))$p$;
    END IF;
    EXECUTE 'GRANT SELECT, INSERT ON billing_events TO application_role';
    EXECUTE 'GRANT USAGE ON SEQUENCE billing_events_id_seq TO application_role';
  END IF;
END $$;

INSERT INTO billing_events
  (user_id, stripe_subscription_id, event_kind, tier, description, occurred_at)
SELECT us.user_id,
       us.stripe_subscription_id,
       'subscription_started',
       us.tier,
       'Subscription started (backfilled)',
       COALESCE(us.updated_at, NOW())
FROM user_subscriptions us
WHERE us.stripe_subscription_id IS NOT NULL
  AND us.status IN ('active', 'trialing', 'past_due')
  AND NOT EXISTS (
    SELECT 1 FROM billing_events be
    WHERE be.stripe_subscription_id = us.stripe_subscription_id
      AND be.event_kind = 'subscription_started'
  );
