-- Scholarly provider metadata. Documentation-only; chunks.metadata JSONB
-- already accepts arbitrary keys. This migration adds an analytics index
-- for Parallel Extract provenance tracking.

COMMENT ON COLUMN sources.parse_method IS
  'Allowed values: html_boilerpipe, pdf_parse, markdown_normalize, plain_text, parallel_extract_v1';

CREATE INDEX IF NOT EXISTS idx_sources_parse_method ON sources(parse_method)
  WHERE parse_method = 'parallel_extract_v1';
