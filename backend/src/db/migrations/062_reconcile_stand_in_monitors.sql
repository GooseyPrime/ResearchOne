-- 062: Monitors that were never created at Parallel (14 Oct 2026).
--
-- Before this release, a monitor started without a Parallel key was stored
-- with a stand-in id ('stub_<uuid>') and marked active, although nothing was
-- watching at Parallel. Such a row is not a working monitor. This marks every
-- active stand-in row paused and records why, so no screen calls it active.
--
-- Additive and idempotent: it touches only rows that are still active with a
-- stand-in id, so a second run changes nothing. No row is deleted, no token
-- balance or Stripe subscription is changed; whether to refund the time those
-- rows held is a billing decision, not this migration's.

WITH paused AS (
  UPDATE report_monitors
     SET status = 'paused',
         paused_at = COALESCE(paused_at, NOW()),
         last_event_at = NOW()
   WHERE status = 'active'
     AND parallel_monitor_id LIKE 'stub\_%' ESCAPE '\'
  RETURNING id
)
INSERT INTO report_monitor_events (monitor_id, event_kind, payload)
SELECT id, 'monitor_paused', '{"reason":"never_created_at_provider"}'::jsonb
  FROM paused;
