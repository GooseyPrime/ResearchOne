-- Preferred citation style for exports (MLA, APA, …). Set at run creation;
-- export API uses it when the client omits an explicit style.

ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS citation_style TEXT NULL;

COMMENT ON COLUMN research_runs.citation_style IS
  'Preferred export citation style (mla, apa, chicago-author-date, …).';
