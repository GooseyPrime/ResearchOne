-- Migration 039: Wave 5.4 — saved orchestration profiles (user/org scoped, RLS).

CREATE TABLE IF NOT EXISTS saved_orchestration_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id          TEXT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NULL,
  base_intent     TEXT NOT NULL,
  customizations  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_shared       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT saved_orchestration_profiles_name_nonempty CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_saved_profiles_user ON saved_orchestration_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_profiles_org ON saved_orchestration_profiles(org_id) WHERE org_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_saved_orchestration_profiles_updated_at ON saved_orchestration_profiles;
CREATE TRIGGER trg_saved_orchestration_profiles_updated_at
  BEFORE UPDATE ON saved_orchestration_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role') THEN
    RAISE NOTICE '039_wave5_saved_orchestration_profiles: application_role missing — skipping RLS';
    RETURN;
  END IF;

  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'saved_orchestration_profiles') THEN
    EXECUTE 'ALTER TABLE saved_orchestration_profiles ENABLE ROW LEVEL SECURITY';

    IF NOT EXISTS (
      SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_orchestration_profiles'
        AND policyname = 'saved_orchestration_profiles_select'
    ) THEN
      EXECUTE $p$CREATE POLICY saved_orchestration_profiles_select ON saved_orchestration_profiles
        FOR SELECT TO application_role
        USING (
          user_id = current_setting('app.user_id', true)
          OR (org_id IS NOT NULL AND org_id = current_setting('app.org_id', true) AND is_shared = TRUE)
        )$p$;
    END IF;

    IF NOT EXISTS (
      SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_orchestration_profiles'
        AND policyname = 'saved_orchestration_profiles_insert'
    ) THEN
      EXECUTE $p$CREATE POLICY saved_orchestration_profiles_insert ON saved_orchestration_profiles
        FOR INSERT TO application_role
        WITH CHECK (user_id = current_setting('app.user_id', true))$p$;
    END IF;

    IF NOT EXISTS (
      SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_orchestration_profiles'
        AND policyname = 'saved_orchestration_profiles_update'
    ) THEN
      EXECUTE $p$CREATE POLICY saved_orchestration_profiles_update ON saved_orchestration_profiles
        FOR UPDATE TO application_role
        USING (user_id = current_setting('app.user_id', true))
        WITH CHECK (user_id = current_setting('app.user_id', true))$p$;
    END IF;

    IF NOT EXISTS (
      SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_orchestration_profiles'
        AND policyname = 'saved_orchestration_profiles_delete'
    ) THEN
      EXECUTE $p$CREATE POLICY saved_orchestration_profiles_delete ON saved_orchestration_profiles
        FOR DELETE TO application_role
        USING (user_id = current_setting('app.user_id', true))$p$;
    END IF;
  END IF;
END $$;
