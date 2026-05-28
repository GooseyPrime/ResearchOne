-- Sticklight UI feedback console: user-submitted comments, bugs, and feature suggestions.

CREATE TABLE IF NOT EXISTS feedback_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT feedback_submissions_category_check CHECK (
    category IN (
      'general_comment',
      'platform_complaint',
      'feature_suggestion',
      'bug_report',
      'integrity_report'
    )
  ),
  CONSTRAINT feedback_submissions_status_check CHECK (
    status IN ('received', 'reviewed', 'closed')
  )
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user_created
  ON feedback_submissions (user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    RAISE NOTICE '044_feedback_submissions: application_role does not exist — skipping RLS policy creation';
    RETURN;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'feedback_submissions') THEN
    EXECUTE 'ALTER TABLE feedback_submissions ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'feedback_submissions'
        AND policyname = 'feedback_submissions_user_isolation'
    ) THEN
      EXECUTE $p$CREATE POLICY feedback_submissions_user_isolation ON feedback_submissions
        FOR ALL TO application_role
        USING (user_id = current_setting('app.user_id', true))$p$;
    END IF;
  END IF;
END $$;
