CREATE TABLE IF NOT EXISTS user_tiers (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tier TEXT NOT NULL DEFAULT 'free_demo' CHECK (tier IN (
    'anonymous','free_demo','student','wallet','pro','team','byok','sovereign','admin'
  )),
  org_id TEXT,
  current_period_reports_used INTEGER NOT NULL DEFAULT 0,
  current_period_deep_reports_used INTEGER NOT NULL DEFAULT 0,
  lifetime_reports_used INTEGER NOT NULL DEFAULT 0,
  current_period_resets_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tier_addons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier TEXT NOT NULL,
  addon_key TEXT NOT NULL,
  addon_price_cents INTEGER NOT NULL,
  included_count_per_period INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tier, addon_key)
);
