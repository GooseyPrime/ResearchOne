-- WO-AE-5: Security fixes for golden-goose-studio Supabase project
-- (project ref: ftnhzjpyjvpyzetrcfht, org: GoldenGooseTees)
--
-- Apply via Supabase SQL editor or:
--   psql "$SUPABASE_BACKUP_URL" -f docs/supabase-ops/golden-goose-studio-security.sql
--
-- Context: a security-advisor pass found four SECURITY DEFINER functions
-- executable by the `anon` role. These functions should only be callable by
-- authenticated users or service-role callers, not by anonymous visitors.
--
-- Note: the rls_enabled_no_policy findings on generation_events and
-- generation_quota are intentional (REVOKE ALL … FROM anon, authenticated
-- is already applied; functions access them via supabaseAdmin). Leave them.

-- Revoke execute from anon on the four SECURITY DEFINER functions.
-- GRANT to authenticated is preserved if it was previously present.
REVOKE EXECUTE ON FUNCTION public.creator_handle() FROM anon;
REVOKE EXECUTE ON FUNCTION public.public_creator_points() FROM anon;
REVOKE EXECUTE ON FUNCTION public.public_design_counts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.qualifying_reuse_points() FROM anon;

-- Verify (should return zero rows):
-- SELECT routine_name
--   FROM information_schema.role_routine_grants
--  WHERE grantee = 'anon'
--    AND routine_name IN (
--      'creator_handle',
--      'public_creator_points',
--      'public_design_counts',
--      'qualifying_reuse_points'
--    );
