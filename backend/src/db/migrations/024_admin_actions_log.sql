CREATE TABLE IF NOT EXISTS admin_actions_log (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  target_user_id TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_log_admin
  ON admin_actions_log(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_log_target
  ON admin_actions_log(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_log_created
  ON admin_actions_log(created_at DESC);
