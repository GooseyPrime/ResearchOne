-- Migration 040: tighten INSERT RLS on saved_orchestration_profiles so org-shared rows
-- cannot target an arbitrary org_id (Wave 5.4 / PR #129 review).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    RAISE NOTICE '040_saved_profiles_insert_rls_org: application_role missing — skipping RLS';
    RETURN;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'saved_orchestration_profiles') THEN
    EXECUTE 'ALTER TABLE saved_orchestration_profiles ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'saved_orchestration_profiles'
        AND policyname = 'saved_orchestration_profiles_insert'
    ) THEN
      EXECUTE 'DROP POLICY saved_orchestration_profiles_insert ON saved_orchestration_profiles';
    END IF;

    EXECUTE $p$CREATE POLICY saved_orchestration_profiles_insert ON saved_orchestration_profiles
      FOR INSERT TO application_role
      WITH CHECK (
        user_id = current_setting('app.user_id', true)
        AND (
          is_shared = FALSE
          OR (
            org_id IS NOT NULL
            AND org_id = current_setting('app.org_id', true)
          )
        )
      )$p$;
  END IF;
END $$;
