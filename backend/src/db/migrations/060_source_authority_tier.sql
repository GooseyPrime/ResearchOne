-- Migration 060: how much standing a source has, as a number from 1 to 4.
-- 1 primary and official, 2 peer-reviewed scholarly work, 3 preprints, established
-- news, reference works and institutional reports, 4 everything else.
-- Nullable. Written at ingest only when AUTHORITY_TIERS_ENABLED is on, from the
-- source's provider, kind and address; no model is asked. Rows stored before this
-- migration, and every row stored with the switch off, keep NULL.
-- Code that writes or reads the column tolerates this migration not being applied yet.
-- This is not evidence_tier (a grade on a stored finding) and not the discourse label.

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS authority_tier SMALLINT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'sources'
       AND con.conname = 'sources_authority_tier_range'
  ) THEN
    ALTER TABLE sources
      ADD CONSTRAINT sources_authority_tier_range
      CHECK (authority_tier IS NULL OR authority_tier BETWEEN 1 AND 4);
  END IF;
END $$;
