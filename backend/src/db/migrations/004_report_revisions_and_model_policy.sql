-- ResearchOne Migration 004: report revision versioning workflow

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS root_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS revision_rationale TEXT,
  ADD COLUMN IF NOT EXISTS revised_by TEXT;

-- Backfill assumes no pre-existing external revision lineage before this migration.
UPDATE reports
SET root_report_id = id
WHERE root_report_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_reports_root_version
  ON reports(root_report_id, version_number DESC);

CREATE TABLE IF NOT EXISTS report_revision_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  request_text TEXT NOT NULL,
  rationale TEXT,
  initiated_by TEXT NOT NULL DEFAULT 'system',
  initiated_by_type TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'queued',
  processed_at TIMESTAMPTZ,
  applied_revision_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_revision_requests_report
  ON report_revision_requests(report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_revisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  base_report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  revised_report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  parent_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  root_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  revision_number INTEGER NOT NULL,
  request_id UUID REFERENCES report_revision_requests(id) ON DELETE SET NULL,
  rationale TEXT,
  initiated_by TEXT NOT NULL DEFAULT 'system',
  initiated_by_type TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'applied',
  change_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  verifier_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  consistency_issues TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_report_revisions_report
  ON report_revisions(report_id, revision_number DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS report_revision_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  revision_id UUID NOT NULL REFERENCES report_revisions(id) ON DELETE CASCADE,
  revised_report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,
  section_title TEXT NOT NULL,
  section_order INTEGER NOT NULL,
  before_content TEXT NOT NULL DEFAULT '',
  after_content TEXT NOT NULL DEFAULT '',
  change_type TEXT NOT NULL DEFAULT 'rewrite',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_revision_sections_revision
  ON report_revision_sections(revision_id, section_order);

CREATE TABLE IF NOT EXISTS report_revision_diffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  revision_id UUID NOT NULL REFERENCES report_revisions(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,
  before_content TEXT NOT NULL DEFAULT '',
  after_content TEXT NOT NULL DEFAULT '',
  diff_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_revision_diffs_revision
  ON report_revision_diffs(revision_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_revision_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  revision_id UUID NOT NULL REFERENCES report_revisions(id) ON DELETE CASCADE,
  author TEXT NOT NULL DEFAULT 'system',
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_revision_citations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  revision_id UUID NOT NULL REFERENCES report_revisions(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,
  citation_status TEXT NOT NULL DEFAULT 'unchanged',
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE report_revision_requests
  ADD CONSTRAINT fk_revision_requests_applied_revision
  FOREIGN KEY (applied_revision_id) REFERENCES report_revisions(id) ON DELETE SET NULL;
