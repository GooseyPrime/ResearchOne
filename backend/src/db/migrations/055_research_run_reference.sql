-- Human-readable, trackable identifier for EVERY research run — including
-- failures. Runs are the unit that can fail; reports only exist when a run
-- succeeded, so a support-facing identifier hung off `reports` would be absent
-- for precisely the cases someone needs to look up.
--
-- Format:  R1-YYYYMMDD-HHMM-XXXXX-C
--
--   R1        product marker, so a reference is recognisable out of context
--   YYYYMMDD  UTC date the run was created
--   HHMM      UTC time, to the minute
--   XXXXX     5 Crockford base32 characters (~33.5M per minute bucket)
--   C         check character over everything before it
--
-- Crockford base32 excludes I, L, O and U, so the alphabet has no character
-- pairs that are confusable when read aloud or transcribed from a screenshot.
-- The check character catches the residual single-character and transposition
-- errors before they become a fruitless database lookup.
--
-- Generation lives HERE rather than in application code on purpose: research
-- runs are inserted from many paths, several of which fall back through
-- progressively smaller column lists when a migration has not been applied.
-- A column DEFAULT covers every one of them, including paths added later.
--
-- Idempotent and safe to replay.

CREATE OR REPLACE FUNCTION run_ref_check_char(payload TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  total INT := 0;
  idx INT;
  position INT;
BEGIN
  -- Position-weighted sum so a transposition changes the result.
  FOR position IN 1..length(payload) LOOP
    idx := strpos(alphabet, substr(payload, position, 1));
    IF idx > 0 THEN
      total := total + (idx - 1) * position;
    END IF;
  END LOOP;
  RETURN substr(alphabet, (total % 32) + 1, 1);
END;
$$;

CREATE OR REPLACE FUNCTION generate_run_ref(created TIMESTAMPTZ DEFAULT NULL, seed TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  stamp TIMESTAMPTZ := COALESCE(created, clock_timestamp());
  entropy TEXT;
  random_part TEXT := '';
  payload TEXT;
  position INT;
  attempt INT := 0;
  candidate TEXT;
BEGIN
  LOOP
    attempt := attempt + 1;

    -- A caller-supplied seed makes the result deterministic, which is what lets
    -- the backfill below assign stable references to historical rows.
    IF seed IS NULL THEN
      entropy := md5(gen_random_uuid()::TEXT || clock_timestamp()::TEXT || attempt::TEXT);
    ELSE
      entropy := md5(seed);
    END IF;

    random_part := '';
    FOR position IN 1..5 LOOP
      random_part := random_part ||
        substr(alphabet, (get_byte(decode(substr(entropy, position * 2 - 1, 2), 'hex'), 0) % 32) + 1, 1);
    END LOOP;

    payload := 'R1' ||
               to_char(stamp AT TIME ZONE 'UTC', 'YYYYMMDD') ||
               to_char(stamp AT TIME ZONE 'UTC', 'HH24MI') ||
               random_part;

    candidate := 'R1-' ||
                 to_char(stamp AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' ||
                 to_char(stamp AT TIME ZONE 'UTC', 'HH24MI') || '-' ||
                 random_part || '-' ||
                 run_ref_check_char(payload);

    -- A deterministic seed has exactly one possible output, so retrying would
    -- spin forever. Uniqueness there is enforced by the index alone.
    EXIT WHEN seed IS NOT NULL OR attempt >= 8;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM research_runs WHERE run_ref = candidate);
  END LOOP;

  RETURN candidate;
END;
$$;

ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS run_ref TEXT NULL;

-- Backfill before the default and the unique index, so historical runs are
-- lookupable too. Seeded from the row id, so replaying the migration produces
-- the same reference rather than churning identifiers support may have quoted.
UPDATE research_runs
   SET run_ref = generate_run_ref(COALESCE(created_at, NOW()), id::TEXT)
 WHERE run_ref IS NULL;

ALTER TABLE research_runs
  ALTER COLUMN run_ref SET DEFAULT generate_run_ref();

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_runs_run_ref
  ON research_runs(run_ref)
  WHERE run_ref IS NOT NULL;
