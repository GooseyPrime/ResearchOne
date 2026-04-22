-- Per-role fallback opt-in now lives in model_overrides (fallbackEnabled); column removed.
ALTER TABLE research_runs DROP COLUMN IF EXISTS allow_fallbacks;
