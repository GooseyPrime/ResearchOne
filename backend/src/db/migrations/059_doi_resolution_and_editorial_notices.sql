-- Migration 059: what a link check found for each saved citation.
-- Both columns are nullable and written only when DOI_RESOLVE_ENABLED is on.
-- Code that writes them tolerates this migration not being applied yet.

ALTER TABLE report_citations
  ADD COLUMN IF NOT EXISTS resolve_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS editorial_notice TEXT NULL;
