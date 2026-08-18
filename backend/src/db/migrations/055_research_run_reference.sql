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

-- Luhn mod N over the 32-character alphabet.
--
-- The first version was a position-weighted sum mod 32, which does NOT detect
-- every single-character substitution: a change of delta d at position p shifts
-- the total by d*p, so any d*p divisible by 32 is invisible. Luhn mod N detects
-- all single-character substitutions and all adjacent transpositions except
-- those differing by exactly N/2.
--
-- MUST stay identical to `runRefCheckChar` in services/research/runReference.ts.
-- `runReference.parity.integration.test.ts` fails if the two ever diverge.
CREATE OR REPLACE FUNCTION run_ref_check_char(payload TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  n CONSTANT INT := 32;
  factor INT := 2;
  total INT := 0;
  addend INT;
  code_point INT;
  pos INT;
BEGIN
  FOR pos IN REVERSE length(payload)..1 LOOP
    code_point := strpos(alphabet, substr(payload, pos, 1)) - 1;
    CONTINUE WHEN code_point < 0;
    addend := factor * code_point;
    factor := CASE WHEN factor = 2 THEN 1 ELSE 2 END;
    addend := (addend / n) + (addend % n);
    total := total + addend;
  END LOOP;
  RETURN substr(alphabet, ((n - (total % n)) % n) + 1, 1);
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
    -- spin forever. Uniqueness there rests on the row id being unique, and is
    -- enforced by the index.
    EXIT WHEN seed IS NOT NULL;

    -- Check for a collision BEFORE giving up. The previous ordering exited on
    -- the attempt limit first, so the final candidate was returned without ever
    -- being checked (Copilot review, PR #211).
    EXIT WHEN NOT EXISTS (SELECT 1 FROM research_runs WHERE run_ref = candidate);

    IF attempt >= 8 THEN
      RAISE EXCEPTION
        'generate_run_ref: could not find a free reference after % attempts', attempt
        USING HINT = 'This indicates an unexpected collision rate; check the random component.';
    END IF;
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
