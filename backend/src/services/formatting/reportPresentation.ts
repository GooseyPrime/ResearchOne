/**
 * Reader-facing clean-up for report text. Kept free of model and database
 * imports so the generator, the read route and the exporters can all use it.
 */
import { REASONING_MODEL_ROLES } from '../reasoning/reasoningModelPolicy';

const TIER_WORD = '(?:established[_ ]fact|strong[_ ]evidence|testimony|inference|speculation)';
/** "[Strong_Evidence - Chunk 3]" -> "[Chunk 3]"; keeps the chunk reference the citation mapper reads. */
const TIER_INSIDE_BRACKET = new RegExp(`\\[\\s*${TIER_WORD}\\s*[-–—:|,]\\s*(?=[^\\]]*\\bchunk\\b)`, 'gi');
/** "[Strong_Evidence]" or "(strong_evidence)" standing alone. */
const TIER_ONLY_BRACKET = new RegExp(`\\s?(?:\\[\\s*${TIER_WORD}\\s*\\]|\\(\\s*${TIER_WORD}\\s*\\))`, 'gi');
/** Snake-case tier tokens used as labels in running text: "STRONG_EVIDENCE:", "established_fact". */
const SNAKE_TIER_TOKEN = /\b(?:established_fact|strong_evidence)\b:?[ \t]*/gi;

/**
 * Bracketed names of the system's own roles, in any case, with underscores or
 * spaces: "[Quantitative_Quality_Auditor]", "[section drafter]". Only names
 * from the role list match, so a bracketed name such as "[New_York_Times]" is
 * left alone.
 */
const ROLE_NAME_PATTERN = REASONING_MODEL_ROLES.map((role) => role.split('_').join('[_ ]')).join('|');
const INTERNAL_STEP_NAME = new RegExp(`\\s?\\[\\s*(?:${ROLE_NAME_PATTERN})\\s*\\]`, 'gi');

/**
 * Left exactly as written: fenced code, inline code, whole Markdown links
 * (text and destination), autolinks and bare URLs.
 */
const PROTECTED_SEGMENT =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\[[^\]\n]*\]\([^)\s]*(?:\s+"[^"]*")?\)|<https?:\/\/[^>\s]+>|https?:\/\/[^\s)\]>]+)/g;

function cleanProse(text: string): string {
  return text
    .replace(TIER_INSIDE_BRACKET, '[')
    .replace(TIER_ONLY_BRACKET, '')
    .replace(SNAKE_TIER_TOKEN, '')
    .replace(INTERNAL_STEP_NAME, '')
    // Tidy only the gaps a removal can leave inside a line; leading indentation
    // (nested lists, code) and table alignment rows are left alone.
    .replace(/(\S)[ \t]+([.,;])/g, '$1$2')
    .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ');
}

/**
 * Removes evidence-tier labels and internal step names from report text a
 * reader sees. Tier grades remain on stored findings for scoring and for an
 * optional evidence view; they are never part of the report prose. Chunk
 * references ("[Chunk 3]") are kept, because citation mapping reads them.
 * Code, links and URLs are never changed.
 */
export function stripInternalLabelsFromReport(markdown: string): string {
  return markdown
    .split(PROTECTED_SEGMENT)
    .map((segment, index) => (index % 2 === 1 ? segment : cleanProse(segment)))
    .join('');
}

interface ReaderFrontMatterLike {
  overall_summary?: unknown;
  conclusions_nutshell?: unknown;
  metric_glosses?: unknown;
}

function cleanIfString(value: unknown): unknown {
  return typeof value === 'string' ? stripInternalLabelsFromReport(value) : value;
}

/**
 * The plain-language version and the front-matter cards are shown to readers
 * from report metadata, not from report sections, so they need the same
 * clean-up. Returns a copy; anything that is not one of those fields is
 * returned untouched.
 */
export function cleanReaderMetadata<T>(metadata: T): T {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;
  const source = metadata as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };
  if (typeof source.plain_language_markdown === 'string') {
    out.plain_language_markdown = stripInternalLabelsFromReport(source.plain_language_markdown);
  }
  const front = source.reader_front_matter as ReaderFrontMatterLike | undefined;
  if (front && typeof front === 'object') {
    out.reader_front_matter = {
      ...front,
      overall_summary: cleanIfString(front.overall_summary),
      conclusions_nutshell: cleanIfString(front.conclusions_nutshell),
      metric_glosses: Array.isArray(front.metric_glosses)
        ? front.metric_glosses.map((gloss: unknown) =>
            gloss && typeof gloss === 'object'
              ? Object.fromEntries(Object.entries(gloss as Record<string, unknown>).map(([k, v]) => [k, cleanIfString(v)]))
              : gloss
          )
        : front.metric_glosses,
    };
  }
  return out as T;
}
