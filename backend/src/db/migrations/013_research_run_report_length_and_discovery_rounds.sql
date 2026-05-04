-- Migration 013: report length steering + discovery round bookkeeping
--
-- 1. `target_word_count`: the user-requested total report length for a run.
--    Routed into the synthesizer's per-section budget directives so the
--    finished report tracks the user's requested size. Nullable so older
--    runs (pre-feature) keep working with the orchestrator-default budget.
--
-- 2. `discovery_round_count`: the number of discovery rounds actually
--    executed for a run. Surfaced in the FailedRunReportPage trace so a
--    reader can confirm whether the run did the second-round sleuthing
--    pass or whether discovery short-circuited.

ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS target_word_count INTEGER,
  ADD COLUMN IF NOT EXISTS discovery_round_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN research_runs.target_word_count IS
  'User-requested total report length in words (clamped to [600, 12000]). NULL means use the orchestrator default. Routed to the synthesizer to steer per-section budgets without padding.';
COMMENT ON COLUMN research_runs.discovery_round_count IS
  'Number of discovery rounds executed (>= 1 when discovery ran, 0 when discovery was skipped). The orchestrator runs at least 2 rounds when round 1 surfaces material new investigation avenues.';
