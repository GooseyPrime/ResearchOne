-- Migration 014: report_revision_requests metadata + supplemental_attachments
--
-- The "Request edit / correction / re-evaluation" UI on the report detail
-- page now accepts file attachments and URLs alongside the free-text request
-- (see PR adding ReportDetailPage drag/drop). Those attachments are queued
-- onto the existing corpus ingestion pipeline tagged with the revision
-- request id, and their extracted text is also spliced into the revision
-- model prompts so the current revision call can use them as evidence.
--
-- This migration adds:
--   - `metadata` jsonb on report_revision_requests for arbitrary per-request
--     bookkeeping the service layer wants to persist (e.g. a count of
--     attachments, total ingest job ids, etc.).
--   - `supplemental_attachments` jsonb storing the attachment manifest
--     (kind/url|filename/mimetype/ingestion_job_id) the UI displays back
--     to the user when they re-open the report's revision history.
--
-- Both default to '{}'/[] so existing rows remain valid; the API and service
-- layer treat NULL/empty as "no attachments" and tolerate older deploys
-- without these columns via try/catch fallbacks.

ALTER TABLE report_revision_requests
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS supplemental_attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN report_revision_requests.metadata IS
  'Free-form per-request metadata (e.g. attachment counts, request_source markers). Supplemental file/URL details live on supplemental_attachments.';
COMMENT ON COLUMN report_revision_requests.supplemental_attachments IS
  'Audit manifest of files/URLs attached to this revision request. Each entry: { kind: "url"|"file", url?, filename?, mimetype?, ingestion_job_id }.';
