-- Scholarly provider metadata. Documentation + partial index for Parallel
-- Extract provenance on sources.fetch_method (added in migration 002).
-- documents.parse_method is separate (also migration 002); ingestion stores
-- fetch provenance on sources.

COMMENT ON COLUMN sources.fetch_method IS
  'Examples: http_get, pdf_parse, markdown_parse, parallel_extract_v1';

CREATE INDEX IF NOT EXISTS idx_sources_fetch_method_parallel_extract_v1
  ON sources(fetch_method)
  WHERE fetch_method = 'parallel_extract_v1';
