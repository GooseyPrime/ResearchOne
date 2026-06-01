-- Research spinoff lineage: new runs forked from an existing report/run.

ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS spinoff_from_run_id UUID REFERENCES research_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS spinoff_from_report_id UUID REFERENCES reports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_research_runs_spinoff_from_run_id
  ON research_runs(spinoff_from_run_id);

COMMENT ON COLUMN research_runs.spinoff_from_run_id IS
  'Parent research run when this row was created via POST /api/research/spinoff.';
COMMENT ON COLUMN research_runs.spinoff_from_report_id IS
  'Parent report when this row was created via POST /api/research/spinoff.';
