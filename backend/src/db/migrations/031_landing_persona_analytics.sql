-- Migration 031: Landing persona analytics.
-- See: .cursor/rules/26-landing-persona-and-visual.mdc (I-2)
-- See: docs/ResearchOne - Work Order V.md
--
-- Append-only. No FK to users. No referrer string. No user id.
-- Records (persona, path, minute) only. Per Rule 26 I-2.
--
-- Idempotent: IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS landing_persona_events (
  id            BIGSERIAL PRIMARY KEY,
  persona       TEXT NOT NULL CHECK (persona IN ('osint','uap','academic','patent','default')),
  path          TEXT NOT NULL,
  -- Bucketed to the minute so aggregates can be computed without
  -- exposing individual visit timing. NOW() truncated to minute on
  -- insert via the trigger below.
  bucketed_at   TIMESTAMPTZ NOT NULL DEFAULT date_trunc('minute', NOW()),
  -- Optional event type — 'view' is current; future could add
  -- 'cta_click' for in-page tracking. Keep enum tight.
  event_type    TEXT NOT NULL DEFAULT 'view' CHECK (event_type IN ('view','cta_click'))
);

CREATE INDEX IF NOT EXISTS idx_landing_persona_events_persona_time
  ON landing_persona_events(persona, bucketed_at DESC);
CREATE INDEX IF NOT EXISTS idx_landing_persona_events_path
  ON landing_persona_events(path);

COMMENT ON TABLE landing_persona_events IS
  'Append-only persona analytics. Per Cursor rule 26 I-2, NO PII or '
  'user-identifying fields. Bucketed to the minute. No FK to users.';
