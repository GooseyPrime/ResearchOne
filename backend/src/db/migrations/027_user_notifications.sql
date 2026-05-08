-- WO-F follow-up: in-app notifications consumer for payment_failed and other
-- billing/account events. Surfaces a banner via GET /api/notifications.

CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  cta_path TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index for the common query: list a user's unread notifications.
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
  ON user_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
