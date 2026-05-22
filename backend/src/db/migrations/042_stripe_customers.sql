CREATE TABLE IF NOT EXISTS stripe_customers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    EXECUTE 'ALTER TABLE stripe_customers ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'stripe_customers' AND policyname = 'stripe_customers_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY stripe_customers_user_isolation ON stripe_customers
        FOR ALL TO application_role
        USING (user_id = current_setting('app.user_id', true))$p$;
    END IF;
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON stripe_customers TO application_role';
  END IF;
END $$;
