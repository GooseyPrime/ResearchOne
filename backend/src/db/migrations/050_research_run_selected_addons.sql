-- Per-run wallet add-ons selected at research start (adversarial_twin, parallel_search, etc.)
ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS selected_addons JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN research_runs.selected_addons IS
  'Wallet surcharged run enhancements from POST /api/research addons[]; mirrored on BullMQ job payload.';
