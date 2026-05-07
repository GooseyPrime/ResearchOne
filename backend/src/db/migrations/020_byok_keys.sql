CREATE TABLE IF NOT EXISTS byok_keys (
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL DEFAULT 'openrouter' CHECK (provider IN (
    'openrouter','anthropic','openai','google'
  )),
  encrypted_key TEXT NOT NULL,
  encrypted_key_iv TEXT NOT NULL,
  encrypted_key_tag TEXT NOT NULL,
  key_last_four TEXT NOT NULL,
  key_validated_at TIMESTAMPTZ,
  key_status TEXT NOT NULL DEFAULT 'pending' CHECK (key_status IN (
    'pending','valid','invalid','revoked'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, provider)
);
