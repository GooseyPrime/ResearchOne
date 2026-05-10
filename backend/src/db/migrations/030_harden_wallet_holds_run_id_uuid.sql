-- Harden wallet_holds.run_id: UUID type + FK to research_runs(id).
-- Replaces deploy-skew workarounds comparing r.id::text to TEXT run_id.
--
-- Idempotent: individual DDL guarded for column type / constraint presence.
-- Invalid UUID strings and UUIDs with no matching research_runs row are audited,
-- then coerced to NULL during ALTER TYPE ... USING (...).

CREATE TABLE IF NOT EXISTS wallet_holds_run_id_migration_audit (
  id BIGSERIAL PRIMARY KEY,
  wallet_hold_id UUID NOT NULL,
  original_run_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('invalid_uuid', 'orphan_no_matching_run')),
  audited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wallet_hold_id)
);

COMMENT ON TABLE wallet_holds_run_id_migration_audit IS
  'wallet_holds rows whose run_id was not migratable to a referencing UUID (invalid text or orphan). Migration 030.';

INSERT INTO wallet_holds_run_id_migration_audit (wallet_hold_id, original_run_id, reason)
SELECT h.id,
       h.run_id,
       CASE
         WHEN trim(h.run_id) = ''
           OR NOT (
             h.run_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
           THEN 'invalid_uuid'::TEXT
         ELSE 'orphan_no_matching_run'::TEXT
       END
FROM wallet_holds h
WHERE NOT EXISTS (
  SELECT 1 FROM wallet_holds_run_id_migration_audit a WHERE a.wallet_hold_id = h.id
)
AND (
  trim(h.run_id) = ''
  OR NOT (
    h.run_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  OR (
    h.run_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND NOT EXISTS (SELECT 1 FROM research_runs r WHERE r.id = h.run_id::uuid)
  )
)
ON CONFLICT (wallet_hold_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallet_holds'
      AND column_name = 'run_id' AND udt_name = 'text'
  ) THEN
    ALTER TABLE wallet_holds ALTER COLUMN run_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wallet_holds'
      AND column_name = 'run_id' AND udt_name = 'text'
  ) THEN
    ALTER TABLE wallet_holds
      ALTER COLUMN run_id TYPE UUID
      USING (
        CASE
          WHEN trim(run_id) = '' THEN NULL
          WHEN run_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
               AND EXISTS (SELECT 1 FROM research_runs r WHERE r.id = run_id::uuid)
            THEN run_id::uuid
          ELSE NULL
        END
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_holds_run_id_fkey'
  ) THEN
    ALTER TABLE wallet_holds
      ADD CONSTRAINT wallet_holds_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wallet_holds_run_id ON wallet_holds(run_id);
