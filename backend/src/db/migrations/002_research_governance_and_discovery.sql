-- ResearchOne Migration 002: Research Governance, Discovery, and Epistemic Persistence
-- Apply after 001_initial_schema.sql

-- ============================================================
-- research_runs: discovery and report linkage
-- ============================================================

ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS discovery_summary JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS report_id UUID NULL,
  ADD COLUMN IF NOT EXISTS corpus_before JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS corpus_after JSONB DEFAULT '{}';

-- Add FK for report_id after reports table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'research_runs_report_id_fkey'
  ) THEN
    ALTER TABLE research_runs
      ADD CONSTRAINT research_runs_report_id_fkey
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- ============================================================
-- sources: provenance and discovery metadata
-- ============================================================

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS discovered_by_run_id UUID NULL,
  ADD COLUMN IF NOT EXISTS discovery_query TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_rank INTEGER NULL,
  ADD COLUMN IF NOT EXISTS imported_via TEXT NULL,
  ADD COLUMN IF NOT EXISTS original_mime_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS original_filename TEXT NULL,
  ADD COLUMN IF NOT EXISTS fetch_method TEXT NULL,
  ADD COLUMN IF NOT EXISTS canonical_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS retrieval_timestamp TIMESTAMPTZ NULL;

-- FK for discovered_by_run_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sources_discovered_by_run_id_fkey'
  ) THEN
    ALTER TABLE sources
      ADD CONSTRAINT sources_discovered_by_run_id_fkey
      FOREIGN KEY (discovered_by_run_id) REFERENCES research_runs(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sources_discovered_by ON sources(discovered_by_run_id);
CREATE INDEX IF NOT EXISTS idx_sources_imported_via ON sources(imported_via);

-- ============================================================
-- documents: parse method and extraction metadata
-- ============================================================

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS parse_method TEXT NULL,
  ADD COLUMN IF NOT EXISTS extraction_metadata JSONB DEFAULT '{}';

-- ============================================================
-- claims: run and report linkage, epistemic enrichment
-- ============================================================

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS run_id UUID NULL,
  ADD COLUMN IF NOT EXISTS report_id UUID NULL,
  ADD COLUMN IF NOT EXISTS stance_summary TEXT NULL,
  ADD COLUMN IF NOT EXISTS supporting_chunk_ids UUID[] NULL,
  ADD COLUMN IF NOT EXISTS contradicting_chunk_ids UUID[] NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'claims_run_id_fkey'
  ) THEN
    ALTER TABLE claims
      ADD CONSTRAINT claims_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'claims_report_id_fkey'
  ) THEN
    ALTER TABLE claims
      ADD CONSTRAINT claims_report_id_fkey
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_claims_run_id ON claims(run_id);
CREATE INDEX IF NOT EXISTS idx_claims_report_id ON claims(report_id);

-- ============================================================
-- contradictions: run and report linkage, contradiction typing
-- ============================================================

ALTER TABLE contradictions
  ADD COLUMN IF NOT EXISTS run_id UUID NULL,
  ADD COLUMN IF NOT EXISTS report_id UUID NULL,
  ADD COLUMN IF NOT EXISTS contradiction_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS severity_score FLOAT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'contradictions_run_id_fkey'
  ) THEN
    ALTER TABLE contradictions
      ADD CONSTRAINT contradictions_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'contradictions_report_id_fkey'
  ) THEN
    ALTER TABLE contradictions
      ADD CONSTRAINT contradictions_report_id_fkey
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_contradictions_run_id ON contradictions(run_id);
CREATE INDEX IF NOT EXISTS idx_contradictions_report_id ON contradictions(report_id);

-- ============================================================
-- report_sections: verifier notes
-- ============================================================

ALTER TABLE report_sections
  ADD COLUMN IF NOT EXISTS verifier_notes JSONB DEFAULT '{}';

-- ============================================================
-- report_citations: enhanced columns
-- ============================================================

ALTER TABLE report_citations
  ADD COLUMN IF NOT EXISTS chunk_quote TEXT NULL,
  ADD COLUMN IF NOT EXISTS citation_order INTEGER NULL,
  ADD COLUMN IF NOT EXISTS discovery_origin JSONB DEFAULT '{}';

-- ============================================================
-- discovery_events: audit table for all discovery activity
-- ============================================================

CREATE TABLE IF NOT EXISTS discovery_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          UUID REFERENCES research_runs(id) ON DELETE CASCADE,
  phase           TEXT NOT NULL,
  provider        TEXT NOT NULL,
  query_text      TEXT,
  result_count    INTEGER DEFAULT 0,
  selected_count  INTEGER DEFAULT 0,
  payload         JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_events_run_id ON discovery_events(run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_events_phase ON discovery_events(phase);
CREATE INDEX IF NOT EXISTS idx_discovery_events_created_at ON discovery_events(created_at DESC);

-- ============================================================
-- ingestion_artifacts: optional ingestion audit
-- ============================================================

CREATE TABLE IF NOT EXISTS ingestion_artifacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingestion_job_id UUID REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  source_id       UUID REFERENCES sources(id) ON DELETE SET NULL,
  original_hash   TEXT,
  extraction_method TEXT,
  parse_warnings  TEXT[],
  artifact_metadata JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_artifacts_job ON ingestion_artifacts(ingestion_job_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_artifacts_source ON ingestion_artifacts(source_id);

-- ============================================================
-- source_type enum: add markdown if not present
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'markdown'
    AND enumtypid = 'source_type'::regtype
  ) THEN
    ALTER TYPE source_type ADD VALUE IF NOT EXISTS 'markdown';
  END IF;
EXCEPTION WHEN others THEN
  NULL; -- ignore if type doesn't exist or already has value
END
$$;
