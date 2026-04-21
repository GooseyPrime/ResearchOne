-- V2 engine flag and research objective typology for Research One 2
ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS engine_version TEXT,
  ADD COLUMN IF NOT EXISTS research_objective TEXT;
