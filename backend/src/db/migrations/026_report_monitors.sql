-- Work Order T: Living Reports / Parallel Monitor infrastructure.
-- user_id / org_id are TEXT to match users(id) and orgs(id) (Clerk-style ids).

CREATE TABLE report_monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT REFERENCES orgs(id) ON DELETE CASCADE,
  monitor_kind TEXT NOT NULL CHECK (monitor_kind IN ('living_report', 'reverse_citation_watch')),
  parallel_monitor_id TEXT NOT NULL,
  query_def JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled', 'failed')),
  stripe_subscription_id TEXT,
  stripe_subscription_item_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  last_revision_id UUID REFERENCES report_revisions(id),
  UNIQUE (report_id, monitor_kind)
);

CREATE INDEX idx_report_monitors_user_id ON report_monitors(user_id);
CREATE INDEX idx_report_monitors_org_id ON report_monitors(org_id);
CREATE INDEX idx_report_monitors_status ON report_monitors(status) WHERE status = 'active';
CREATE INDEX idx_report_monitors_parallel_id ON report_monitors(parallel_monitor_id);

CREATE TABLE report_monitor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID NOT NULL REFERENCES report_monitors(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL
    CHECK (event_kind IN ('webhook_received', 'webhook_replayed', 'webhook_invalid_signature',
                          'revision_enqueued', 'revision_completed', 'revision_failed',
                          'monitor_paused', 'monitor_resumed', 'monitor_cancelled',
                          'subscription_active', 'subscription_past_due', 'subscription_cancelled')),
  webhook_event_id TEXT,
  payload JSONB,
  revision_id UUID REFERENCES report_revisions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_monitor_events_monitor_id ON report_monitor_events(monitor_id, created_at DESC);
CREATE UNIQUE INDEX idx_report_monitor_events_webhook_idempotency ON report_monitor_events(webhook_event_id)
  WHERE webhook_event_id IS NOT NULL;

ALTER TABLE report_revisions
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN report_revisions.metadata IS
  'Revision bookkeeping (e.g. triggeredBy: user | parallel_monitor | reverse_citation_watch).';

-- RLS (WO-K pattern): customer rows scoped by app.user_id / app.org_id session vars.
ALTER TABLE report_monitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_monitors_user_isolation ON report_monitors
  FOR ALL TO application_role
  USING (
    user_id = current_setting('app.user_id', true)
    OR (org_id IS NOT NULL AND org_id = current_setting('app.org_id', true))
  );

ALTER TABLE report_monitor_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_monitor_events_via_monitor ON report_monitor_events
  FOR ALL TO application_role
  USING (
    EXISTS (
      SELECT 1 FROM report_monitors rm
      WHERE rm.id = report_monitor_events.monitor_id
        AND (
          rm.user_id = current_setting('app.user_id', true)
          OR (rm.org_id IS NOT NULL AND rm.org_id = current_setting('app.org_id', true))
        )
    )
  );
