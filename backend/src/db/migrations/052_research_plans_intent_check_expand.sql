-- Migration 052: Expand research_plans_intent_check to include Wave 5.2+
-- intent values added in intentTaxonomy.ts after migration 035 shipped.
-- Previously missing: story_verification, opportunity_discovery, feasibility, implementation.
-- Without this migration, the intent classifier returning any of those four values
-- caused a Postgres 23514 check-constraint violation during plan insertion, which
-- the orchestrator classified as non_recoverable (unknown_error) and aborted the run.

ALTER TABLE research_plans DROP CONSTRAINT IF EXISTS research_plans_intent_check;
ALTER TABLE research_plans ADD CONSTRAINT research_plans_intent_check
  CHECK (intent IN (
    'legacy',
    'factual_report',
    'survey',
    'adjudication',
    'investigation',
    'story_verification',
    'opportunity_discovery',
    'feasibility',
    'implementation',
    'literature_review',
    'comparative',
    'how_to',
    'recommendation',
    'exploratory',
    'position_brief',
    'timeline',
    'reference_lookup'
  ));
