-- Wallet holds for pre-run credit reservation.
-- reserved_cents tracks the total of all active holds for a user.
-- The placeHold SQL uses: UPDATE ... WHERE balance_cents - reserved_cents >= $cost

ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS reserved_cents BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS wallet_holds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  hold_cents BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'released', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_holds_user_active
  ON wallet_holds(user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_wallet_holds_expires
  ON wallet_holds(expires_at) WHERE status = 'active';
