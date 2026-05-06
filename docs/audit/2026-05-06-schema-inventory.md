# Schema inventory — `backend/src/db/migrations/`

Generated from SQL migrations only (no live DB introspection). Apply order is **lexicographic filename sort** per `backend/src/db/migrate.ts`.

**Note:** Filenames are not strictly monotonic: there are two `004_*` and two `005_*` files; order is `004_report_revisions…` before `004_runtime_model_overrides…`, and `005_research_run_progress…` before `005_research_supplemental…`.

---

## Migration tracking

| Object | Definition |
|--------|------------|
| `schema_migrations` | Created by runner: `id SERIAL PK`, `filename TEXT UNIQUE`, `applied_at TIMESTAMPTZ` |

---

## `001_initial_schema.sql`

### Extensions

`uuid-ossp`, `vector`, `pg_trgm`

### Enum types

| Type | Values |
|------|--------|
| `evidence_tier` | established_fact, strong_evidence, testimony, inference, speculation |
| `source_type` | web_url, pdf, text, arxiv, doi, youtube_transcript, api_import |
| `job_status` | queued, running, completed, failed, cancelled |
| `report_status` | draft, generating, under_review, finalized, archived |
| `claim_stance` | supports, contradicts, neutral, ambiguous |

### Tables (columns, PK/FK, checks)

| Table | Columns (summary) | Constraints / indexes |
|-------|---------------------|------------------------|
| `sources` | id UUID PK, url, title, authors[], publication, published_at, source_type, raw_content, content_hash UNIQUE, language, tags[], metadata JSONB, ingested_at, created_at, updated_at | idx url, type, ingested_at DESC, GIN tags, GIN metadata |
| `documents` | id PK, source_id FK→sources CASCADE, title, content, content_tokens, language, doc_metadata, created_at, updated_at | idx source_id, created_at DESC, GIN FTS title+content |
| `chunks` | id PK, document_id FK→documents CASCADE, source_id FK→sources CASCADE, chunk_index, content, token_count, start_char, end_char, metadata, created_at | idx document_id, source_id, (document_id, chunk_index), GIN FTS content |
| `embeddings` | id PK, chunk_id FK→chunks CASCADE UNIQUE, model, dimensions, vector vector(1536), created_at | HNSW idx on vector; idx chunk_id, model |
| `entities` | id PK, name, entity_type, aliases[], description, metadata, created_at, updated_at | UNIQUE(name, entity_type); idx type, name |
| `entity_mentions` | id PK, entity_id FK→entities CASCADE, chunk_id FK→chunks CASCADE, mention_text, confidence, created_at | idx entity_id, chunk_id |
| `claims` | id PK, chunk_id FK SET NULL, source_id FK SET NULL, claim_text, evidence_tier, confidence, entities[], tags[], metadata, created_at, updated_at | idx chunk_id, source_id, evidence_tier, GIN tags, GIN FTS claim_text |
| `contradictions` | id PK, claim_a_id FK CASCADE, claim_b_id FK CASCADE, description, severity, resolution_notes, resolved, metadata, created_at, updated_at | CHECK claim_a_id <> claim_b_id; idx claim_a, claim_b, resolved |
| `research_runs` | id PK, title, query, supplemental, status job_status, plan JSONB, retrieval_ids UUID[], model_log JSONB, error_message, started_at, completed_at, created_at, updated_at | idx status, created_at DESC |
| `reports` | id PK, run_id FK→research_runs SET NULL, title, query, status report_status, executive_summary, conclusion, falsification_criteria, unresolved_questions[], recommended_queries[], evidence_tier_summary JSONB, contradiction_count, source_count, chunk_count, metadata, finalized_at, created_at, updated_at | idx status, run_id, created_at DESC, GIN FTS |
| `report_sections` | id PK, report_id FK CASCADE, section_type, title, content, section_order, evidence_tiers JSONB, source_ids[], claim_ids[], metadata, created_at, updated_at | idx (report_id, section_order) |
| `report_citations` | id PK, report_id FK CASCADE, section_id FK CASCADE, chunk_id SET NULL, claim_id SET NULL, source_id SET NULL, citation_text, evidence_tier, stance claim_stance, created_at | idx report_id, section_id |
| `ingestion_jobs` | id PK, url, file_name, source_type, status job_status, source_id SET NULL, error_message, started_at, completed_at, metadata, created_at, updated_at | idx status, created_at DESC |
| `atlas_exports` | id PK, label, description, filter_tags[], chunk_count, export_path, metadata, created_at | idx created_at DESC |
| `error_log` | id PK, service, job_id, error_code, message, stack_trace, context JSONB, created_at | idx service, created_at DESC |

### View

`corpus_stats` — aggregated counts + `pg_database_size`

### Triggers

`update_updated_at()` on sources, documents, claims, contradictions, research_runs, reports, report_sections, ingestion_jobs

---

## `002_research_governance_and_discovery.sql`

- **ALTER** `research_runs`: discovery_summary, report_id (+ FK to reports), corpus_before, corpus_after
- **ALTER** `sources`: discovered_by_run_id (+ FK research_runs), discovery_query, source_rank, imported_via, original_mime_type, original_filename, fetch_method, canonical_url, retrieval_timestamp — indexes on discovered_by_run_id, imported_via
- **ALTER** `documents`: parse_method, extraction_metadata
- **ALTER** `claims`: run_id, report_id (+ FKs), stance_summary, supporting_chunk_ids[], contradicting_chunk_ids[] — indexes run_id, report_id
- **ALTER** `contradictions`: run_id, report_id (+ FKs), contradiction_type, severity_score — indexes run_id, report_id
- **ALTER** `report_sections`: verifier_notes JSONB
- **ALTER** `report_citations`: chunk_quote, citation_order, discovery_origin JSONB
- **CREATE** `discovery_events` — indexes run_id, phase, created_at DESC
- **CREATE** `ingestion_artifacts` — indexes ingestion_job_id, source_id
- **ALTER TYPE** `source_type` ADD VALUE `markdown` (wrapped in DO block with exception handler)

---

## `003_runtime_health_checkpoints.sql`

- **ALTER** `research_runs`: failed_stage, failure_meta JSONB
- **CREATE** `research_run_checkpoints`: id PK, run_id FK CASCADE, stage, checkpoint_key, snapshot JSONB, created_at — **UNIQUE (run_id, checkpoint_key)** — index (run_id, stage, created_at DESC)

---

## `004_report_revisions_and_model_policy.sql`

- **ALTER** `reports`: root_report_id, parent_report_id (self-FKs), version_number, revision_rationale, revised_by — index (root_report_id, version_number DESC)
- **CREATE** `report_revision_requests`, `report_revisions` (UNIQUE report_id+revision_number), `report_revision_sections`, `report_revision_diffs`, `report_revision_comments`, `report_revision_citations` — multiple FKs and indexes per table
- **ALTER** `report_revision_requests`: FK applied_revision_id → report_revisions

---

## `004_runtime_model_overrides.sql`

- **CREATE** `runtime_model_overrides`: id SMALLINT PK CHECK (id=1), overrides JSONB, updated_at — seed row id=1

---

## `005_research_run_progress_columns.sql`

- **ALTER** `research_runs`: progress_stage, progress_percent, progress_message, progress_updated_at

---

## `005_research_supplemental_attachments.sql`

- **ALTER** `research_runs`: supplemental_attachments JSONB default `[]`

---

## `006_report_plain_language_metadata.sql`

No DDL — `SELECT 1` placeholder (plain-language text stored in `reports.metadata`)

---

## `007_research_run_overrides_and_progress_events.sql`

- **ALTER** `research_runs`: model_overrides JSONB, model_ensemble JSONB, progress_events JSONB

---

## `008_research_run_engine_and_objective.sql`

- **ALTER** `research_runs`: engine_version TEXT, research_objective TEXT

---

## `009_research_v2_objective_and_fallbacks.sql`

- UPDATE legacy objective values
- **ALTER** `research_runs`: allow_fallbacks BOOLEAN (later dropped in 010)

---

## `010_drop_research_runs_allow_fallbacks.sql`

- **ALTER** `research_runs` DROP COLUMN allow_fallbacks

---

## `011_research_resume_job_payload.sql`

- **ALTER** `research_runs`: resume_job_payload JSONB

---

## `012_research_run_aborted_state.sql`

`-- @migrate:no-transaction`

- **ALTER TYPE** `job_status` ADD VALUE `aborted`
- **ALTER** `research_runs`: retry_attempts INT DEFAULT 0, retry_budget INT DEFAULT 3 — COMMENTs on columns

---

## `013_research_run_report_length_and_discovery_rounds.sql`

- **ALTER** `research_runs`: target_word_count INT NULL, discovery_round_count INT NOT NULL DEFAULT 0 — COMMENTs

---

## `014_report_revision_request_metadata.sql`

- **ALTER** `report_revision_requests`: metadata JSONB DEFAULT `{}`, supplemental_attachments JSONB DEFAULT `[]` — COMMENTs

---

## Summary table / index count (initial + migrations)

Core user tables: sources, documents, chunks, embeddings, entities, entity_mentions, claims, contradictions, research_runs (+ checkpoints), reports, report_sections, report_citations, ingestion_jobs, atlas_exports, error_log, discovery_events, ingestion_artifacts, runtime_model_overrides, full report revision suite (6 tables). **View:** corpus_stats.
