-- User-selected output preferences stored at run creation time (optional columns).
-- requested_formats: array of format slugs (e.g. ['narrative_briefing','ranked_options']);
--   NULL means automatic / unset.
-- requested_research_objective: raw objective string as submitted by the user.
-- requested_methodology: user-requested methodology ('auto'|'standard'|'policyone') before triage.
ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS requested_formats JSONB,
  ADD COLUMN IF NOT EXISTS requested_research_objective TEXT,
  ADD COLUMN IF NOT EXISTS requested_methodology TEXT;

COMMENT ON COLUMN research_runs.requested_formats IS
  'User-selected report format slugs at queue time. NULL = automatic.';
COMMENT ON COLUMN research_runs.requested_research_objective IS
  'Raw research objective value as submitted by the user.';
COMMENT ON COLUMN research_runs.requested_methodology IS
  'User-requested methodology (auto/standard/policyone) before triage resolution.';
