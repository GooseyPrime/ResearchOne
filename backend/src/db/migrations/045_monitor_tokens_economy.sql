-- Monitor token economy for Living Reports (per-report tokens, separate from API wallet).

CREATE TABLE user_monitor_balances (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_balance INT NOT NULL DEFAULT 0 CHECK (token_balance >= 0),
  auto_topup_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_topup_package_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE monitor_token_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  stripe_checkout_session_id TEXT,
  monitor_id UUID REFERENCES report_monitors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_monitor_token_ledger_user_id ON monitor_token_ledger(user_id, created_at DESC);

ALTER TABLE report_monitors
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_report_monitors_expires_active
  ON report_monitors(expires_at)
  WHERE status = 'active' AND monitor_kind = 'living_report';

COMMENT ON TABLE user_monitor_balances IS
  'Living Report monitor tokens (integer units). Not API wallet balance_cents.';
COMMENT ON COLUMN report_monitors.expires_at IS
  'Token-funded living_report monitors: active until this timestamp; NULL for legacy Stripe rows.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    RAISE NOTICE '045_monitor_tokens: application_role does not exist — skipping RLS';
    RETURN;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_monitor_balances') THEN
    EXECUTE 'ALTER TABLE user_monitor_balances ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'user_monitor_balances'
        AND policyname = 'user_monitor_balances_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY user_monitor_balances_user_isolation ON user_monitor_balances
        FOR ALL TO application_role
        USING (user_id = current_setting('app.user_id', true))$p$;
    END IF;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'monitor_token_ledger') THEN
    EXECUTE 'ALTER TABLE monitor_token_ledger ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'monitor_token_ledger'
        AND policyname = 'monitor_token_ledger_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY monitor_token_ledger_user_isolation ON monitor_token_ledger
        FOR ALL TO application_role
        USING (user_id = current_setting('app.user_id', true))$p$;
    END IF;
  END IF;
END $$;
