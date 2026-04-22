-- Normalize legacy research objective + Research One 2 fallback opt-in
UPDATE research_runs
SET research_objective = 'GENERAL_EPISTEMIC_RESEARCH'
WHERE research_objective = 'GENERAL';

ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS allow_fallbacks BOOLEAN NOT NULL DEFAULT FALSE;
