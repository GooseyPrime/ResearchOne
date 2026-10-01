/**
 * Reader-facing clean-up for report text. Kept free of model and database
 * imports so the generator, the read route and the exporters can all use it.
 */

const TIER_WORD = '(?:established[_ ]fact|strong[_ ]evidence|testimony|inference|speculation)';
/** "[Strong_Evidence - Chunk 3]" -> "[Chunk 3]"; keeps the chunk reference the citation mapper reads. */
const TIER_INSIDE_BRACKET = new RegExp(`\\[\\s*${TIER_WORD}\\s*[-–—:|,]\\s*(?=[^\\]]*\\bchunk\\b)`, 'gi');
/** "[Strong_Evidence]" or "(strong_evidence)" standing alone. */
const TIER_ONLY_BRACKET = new RegExp(`\\s?[\\[(]\\s*${TIER_WORD}\\s*[\\])]`, 'gi');
/** Snake-case tier tokens used as labels in running text: "STRONG_EVIDENCE:", "established_fact". */
const SNAKE_TIER_TOKEN = /\b(?:established_fact|strong_evidence)\b:?[ \t]*/gi;
/** Internal step names in brackets, e.g. "[Quantitative_Quality_Auditor]". */
const INTERNAL_STEP_NAME = /\s?\[[A-Z][a-z]+(?:_[A-Z][a-z]+)+\]/g;

/**
 * Removes evidence-tier labels and internal step names from report text a
 * reader sees. Tier grades remain on claim rows for scoring and for an optional
 * evidence view; they are never part of the report prose. Chunk references
 * ("[Chunk 3]") are kept, because citation mapping reads them.
 */
export function stripInternalLabelsFromReport(markdown: string): string {
  return markdown
    .replace(TIER_INSIDE_BRACKET, '[')
    .replace(TIER_ONLY_BRACKET, '')
    .replace(SNAKE_TIER_TOKEN, '')
    .replace(INTERNAL_STEP_NAME, '')
    // Tidy only the gaps a removal can leave inside a line; leading indentation
    // (nested lists, code) and table alignment rows are left alone.
    .replace(/(\S)[ \t]+([.,;])/g, '$1$2')
    .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ');
}
