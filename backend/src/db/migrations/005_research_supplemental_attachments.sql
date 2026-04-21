-- Supplemental files/URLs attached to a research run (JSON array), ingested into corpus at run start
ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS supplemental_attachments JSONB DEFAULT '[]'::jsonb;
