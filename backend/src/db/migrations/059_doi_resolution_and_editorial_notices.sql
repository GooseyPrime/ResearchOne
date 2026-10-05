-- Migration 059: DOI resolution and editorial notices for citations
-- Adds nullable resolve_status and editorial_notice columns to report_citations table

-- Add columns to report_citations table
ALTER TABLE report_citations
  ADD COLUMN IF NOT EXISTS resolve_status TEXT NULL
    CHECK (
      resolve_status IS NULL OR resolve_status IN (
        'resolved',
        'unresolved', 
        'retracted',
        'corrected',
        'withdrawn',
        'unknown'
      )
    ),
  ADD COLUMN IF NOT EXISTS editorial_notice TEXT NULL;

-- Create indexes for the new columns if they don't exist
CREATE INDEX IF NOT EXISTS idx_report_citations_resolve_status ON report_citations(resolve_status)
  WHERE resolve_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_citations_editorial_notice ON report_citations(editorial_notice)
  WHERE editorial_notice IS NOT NULL;