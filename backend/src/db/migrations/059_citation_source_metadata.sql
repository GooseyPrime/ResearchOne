-- Slice 4. Nullable source metadata and citation resolution. Additive only.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS authors text;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS publisher text;
ALTER TABLE report_citations ADD COLUMN IF NOT EXISTS resolve_status text;
ALTER TABLE report_citations ADD COLUMN IF NOT EXISTS editorial_notice text;
