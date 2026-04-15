-- ResearchOne Full Schema Migration
-- Run on truvector-postgres

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";  -- pgvector for embedding storage
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- trigram for full-text search

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE evidence_tier AS ENUM (
  'established_fact',
  'strong_evidence',
  'testimony',
  'inference',
  'speculation'
);

CREATE TYPE source_type AS ENUM (
  'web_url',
  'pdf',
  'text',
  'arxiv',
  'doi',
  'youtube_transcript',
  'api_import'
);

CREATE TYPE job_status AS ENUM (
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE report_status AS ENUM (
  'draft',
  'generating',
  'under_review',
  'finalized',
  'archived'
);

CREATE TYPE claim_stance AS ENUM (
  'supports',
  'contradicts',
  'neutral',
  'ambiguous'
);

-- ============================================================
-- SOURCES
-- Tracks every external resource brought into the corpus
-- ============================================================

CREATE TABLE sources (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  url           TEXT,
  title         TEXT,
  authors       TEXT[],
  publication   TEXT,
  published_at  TIMESTAMPTZ,
  source_type   source_type NOT NULL DEFAULT 'web_url',
  raw_content   TEXT,
  content_hash  TEXT UNIQUE,
  language      TEXT DEFAULT 'en',
  tags          TEXT[],
  metadata      JSONB DEFAULT '{}',
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sources_url ON sources(url);
CREATE INDEX idx_sources_type ON sources(source_type);
CREATE INDEX idx_sources_ingested_at ON sources(ingested_at DESC);
CREATE INDEX idx_sources_tags ON sources USING GIN(tags);
CREATE INDEX idx_sources_metadata ON sources USING GIN(metadata);

-- ============================================================
-- DOCUMENTS
-- Processed, cleaned versions of source content
-- ============================================================

CREATE TABLE documents (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id      UUID REFERENCES sources(id) ON DELETE CASCADE,
  title          TEXT,
  content        TEXT NOT NULL,
  content_tokens INTEGER,
  language       TEXT DEFAULT 'en',
  doc_metadata   JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_source_id ON documents(source_id);
CREATE INDEX idx_documents_created_at ON documents(created_at DESC);

-- Full-text search index on documents
CREATE INDEX idx_documents_content_fts ON documents USING GIN(
  to_tsvector('english', coalesce(title, '') || ' ' || content)
);

-- ============================================================
-- CHUNKS
-- Segmented document fragments for retrieval
-- ============================================================

CREATE TABLE chunks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id   UUID REFERENCES documents(id) ON DELETE CASCADE,
  source_id     UUID REFERENCES sources(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  token_count   INTEGER,
  start_char    INTEGER,
  end_char      INTEGER,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chunks_document_id ON chunks(document_id);
CREATE INDEX idx_chunks_source_id ON chunks(source_id);
CREATE INDEX idx_chunks_index ON chunks(document_id, chunk_index);

-- Full-text search on chunks
CREATE INDEX idx_chunks_content_fts ON chunks USING GIN(
  to_tsvector('english', content)
);

-- ============================================================
-- EMBEDDINGS
-- Vector representations of chunks for semantic retrieval
-- ============================================================

CREATE TABLE embeddings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chunk_id      UUID REFERENCES chunks(id) ON DELETE CASCADE UNIQUE,
  model         TEXT NOT NULL,
  dimensions    INTEGER NOT NULL,
  vector        vector(1536),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_embeddings_vector_hnsw ON embeddings
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_embeddings_chunk_id ON embeddings(chunk_id);
CREATE INDEX idx_embeddings_model ON embeddings(model);

-- ============================================================
-- ENTITIES
-- Named entities extracted from documents
-- ============================================================

CREATE TABLE entities (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  aliases       TEXT[],
  description   TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, entity_type)
);

CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_name ON entities(name);

-- Entity mentions in chunks
CREATE TABLE entity_mentions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id     UUID REFERENCES entities(id) ON DELETE CASCADE,
  chunk_id      UUID REFERENCES chunks(id) ON DELETE CASCADE,
  mention_text  TEXT,
  confidence    FLOAT DEFAULT 1.0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_entity_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX idx_entity_mentions_chunk ON entity_mentions(chunk_id);

-- ============================================================
-- CLAIMS
-- Discrete factual assertions extracted from chunks
-- ============================================================

CREATE TABLE claims (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chunk_id        UUID REFERENCES chunks(id) ON DELETE SET NULL,
  source_id       UUID REFERENCES sources(id) ON DELETE SET NULL,
  claim_text      TEXT NOT NULL,
  evidence_tier   evidence_tier NOT NULL DEFAULT 'inference',
  confidence      FLOAT DEFAULT 0.5,
  entities        UUID[],
  tags            TEXT[],
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_claims_chunk_id ON claims(chunk_id);
CREATE INDEX idx_claims_source_id ON claims(source_id);
CREATE INDEX idx_claims_evidence_tier ON claims(evidence_tier);
CREATE INDEX idx_claims_tags ON claims USING GIN(tags);
CREATE INDEX idx_claims_content_fts ON claims USING GIN(
  to_tsvector('english', claim_text)
);

-- ============================================================
-- CONTRADICTIONS
-- Explicit contradiction records between two claims
-- ============================================================

CREATE TABLE contradictions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_a_id        UUID REFERENCES claims(id) ON DELETE CASCADE,
  claim_b_id        UUID REFERENCES claims(id) ON DELETE CASCADE,
  description       TEXT NOT NULL,
  severity          TEXT DEFAULT 'moderate',
  resolution_notes  TEXT,
  resolved          BOOLEAN DEFAULT FALSE,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (claim_a_id <> claim_b_id)
);

CREATE INDEX idx_contradictions_claim_a ON contradictions(claim_a_id);
CREATE INDEX idx_contradictions_claim_b ON contradictions(claim_b_id);
CREATE INDEX idx_contradictions_resolved ON contradictions(resolved);

-- ============================================================
-- RESEARCH RUNS / JOBS
-- ============================================================

CREATE TABLE research_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL,
  query           TEXT NOT NULL,
  supplemental    TEXT,
  status          job_status NOT NULL DEFAULT 'queued',
  plan            JSONB,
  retrieval_ids   UUID[],
  model_log       JSONB DEFAULT '[]',
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_runs_status ON research_runs(status);
CREATE INDEX idx_runs_created_at ON research_runs(created_at DESC);

-- ============================================================
-- REPORTS
-- ============================================================

CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          UUID REFERENCES research_runs(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  query           TEXT NOT NULL,
  status          report_status NOT NULL DEFAULT 'draft',
  executive_summary TEXT,
  conclusion      TEXT,
  falsification_criteria TEXT,
  unresolved_questions TEXT[],
  recommended_queries  TEXT[],
  evidence_tier_summary JSONB DEFAULT '{}',
  contradiction_count  INTEGER DEFAULT 0,
  source_count         INTEGER DEFAULT 0,
  chunk_count          INTEGER DEFAULT 0,
  metadata        JSONB DEFAULT '{}',
  finalized_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_run_id ON reports(run_id);
CREATE INDEX idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX idx_reports_fts ON reports USING GIN(
  to_tsvector('english',
    coalesce(title, '') || ' ' ||
    coalesce(executive_summary, '') || ' ' ||
    coalesce(conclusion, '')
  )
);

-- ============================================================
-- REPORT SECTIONS
-- ============================================================

CREATE TABLE report_sections (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id       UUID REFERENCES reports(id) ON DELETE CASCADE,
  section_type    TEXT NOT NULL,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  section_order   INTEGER NOT NULL,
  evidence_tiers  JSONB DEFAULT '{}',
  source_ids      UUID[],
  claim_ids       UUID[],
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sections_report_id ON report_sections(report_id, section_order);

-- ============================================================
-- REPORT CITATIONS
-- ============================================================

CREATE TABLE report_citations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id       UUID REFERENCES reports(id) ON DELETE CASCADE,
  section_id      UUID REFERENCES report_sections(id) ON DELETE CASCADE,
  chunk_id        UUID REFERENCES chunks(id) ON DELETE SET NULL,
  claim_id        UUID REFERENCES claims(id) ON DELETE SET NULL,
  source_id       UUID REFERENCES sources(id) ON DELETE SET NULL,
  citation_text   TEXT,
  evidence_tier   evidence_tier NOT NULL DEFAULT 'inference',
  stance          claim_stance NOT NULL DEFAULT 'supports',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_citations_report ON report_citations(report_id);
CREATE INDEX idx_citations_section ON report_citations(section_id);

-- ============================================================
-- INGESTION JOBS
-- ============================================================

CREATE TABLE ingestion_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  url             TEXT,
  file_name       TEXT,
  source_type     source_type NOT NULL DEFAULT 'web_url',
  status          job_status NOT NULL DEFAULT 'queued',
  source_id       UUID REFERENCES sources(id) ON DELETE SET NULL,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX idx_ingestion_jobs_created_at ON ingestion_jobs(created_at DESC);

-- ============================================================
-- ATLAS EXPORTS
-- ============================================================

CREATE TABLE atlas_exports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label           TEXT NOT NULL,
  description     TEXT,
  filter_tags     TEXT[],
  chunk_count     INTEGER DEFAULT 0,
  export_path     TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_atlas_exports_created_at ON atlas_exports(created_at DESC);

-- ============================================================
-- ERROR LOG
-- ============================================================

CREATE TABLE error_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service         TEXT NOT NULL,
  job_id          UUID,
  error_code      TEXT,
  message         TEXT NOT NULL,
  stack_trace     TEXT,
  context         JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_errors_service ON error_log(service);
CREATE INDEX idx_errors_created_at ON error_log(created_at DESC);

-- ============================================================
-- CORPUS STATS VIEW
-- ============================================================

CREATE VIEW corpus_stats AS
SELECT
  (SELECT COUNT(*) FROM sources)                                   AS source_count,
  (SELECT COUNT(*) FROM documents)                                  AS document_count,
  (SELECT COUNT(*) FROM chunks)                                     AS chunk_count,
  (SELECT COUNT(*) FROM embeddings)                                 AS embedding_count,
  (SELECT COUNT(*) FROM claims)                                     AS claim_count,
  (SELECT COUNT(*) FROM contradictions)                             AS contradiction_count,
  (SELECT COUNT(*) FROM contradictions WHERE resolved = FALSE)      AS open_contradiction_count,
  (SELECT COUNT(*) FROM reports WHERE status = 'finalized')         AS finalized_report_count,
  (SELECT COUNT(*) FROM research_runs WHERE status = 'running')     AS active_run_count,
  (SELECT pg_size_pretty(pg_database_size(current_database())))     AS db_size;

-- ============================================================
-- UPDATE TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sources_updated_at
  BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_claims_updated_at
  BEFORE UPDATE ON claims FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_contradictions_updated_at
  BEFORE UPDATE ON contradictions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_research_runs_updated_at
  BEFORE UPDATE ON research_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_report_sections_updated_at
  BEFORE UPDATE ON report_sections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_ingestion_jobs_updated_at
  BEFORE UPDATE ON ingestion_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
