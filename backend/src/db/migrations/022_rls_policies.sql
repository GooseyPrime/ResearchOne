-- RLS Policies: Enable row-level security on customer-data tables.
-- Stage 2 of the deploy-skew rollout: applied AFTER code connects as application_role.
--
-- Policy predicate: user_id matches app.user_id session var,
-- OR org_id matches app.org_id (for team shared access).
-- current_setting(..., true) returns NULL (not error) when the var is unset,
-- which means unset sessions see zero rows — the safe default.
--
-- Tables listed in WO K spec that exist today and have user_id columns.
-- Future WOs add user_id to corpus tables; their RLS policies will be
-- added in the same migration that adds the column.

-- user_wallets
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_wallets_user_isolation ON user_wallets
  FOR ALL TO application_role
  USING (user_id = current_setting('app.user_id', true));

-- wallet_ledger
ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_ledger_user_isolation ON wallet_ledger
  FOR ALL TO application_role
  USING (user_id = current_setting('app.user_id', true));

-- wallet_holds
ALTER TABLE wallet_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_holds_user_isolation ON wallet_holds
  FOR ALL TO application_role
  USING (user_id = current_setting('app.user_id', true));

-- user_subscriptions
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_subscriptions_user_isolation ON user_subscriptions
  FOR ALL TO application_role
  USING (user_id = current_setting('app.user_id', true));

-- user_tiers
ALTER TABLE user_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_tiers_user_isolation ON user_tiers
  FOR ALL TO application_role
  USING (
    user_id = current_setting('app.user_id', true)
    OR (org_id IS NOT NULL AND org_id = current_setting('app.org_id', true))
  );

-- byok_keys
ALTER TABLE byok_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY byok_keys_user_isolation ON byok_keys
  FOR ALL TO application_role
  USING (user_id = current_setting('app.user_id', true));

-- stripe_webhook_events: no user_id column; admin-only via RLS bypass.
-- It is already append-only for application_role (021_rls_setup.sql).

-- tier_addons: global config, no RLS. Read-only for application_role (021_rls_setup.sql).

-- users, orgs, org_members: identity tables. RLS policies for these
-- are deferred until the admin/user-management routes are locked down.
-- Currently only written by Clerk webhooks (which bypass RLS via admin pool).
