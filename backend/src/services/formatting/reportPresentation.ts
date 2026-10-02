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
 * Left exactly as written:
 * - fenced code with any fence length (```, ````, ~~~ ...), indented up to three
 *   spaces, closed by the same fence or running to the end of the text;
 * - inline code spans with any number of backticks;
 * - indented code: any line starting with four spaces or a tab (deeply nested
 *   list text is skipped too, which is the safe direction);
 * - whole Markdown links (text and destination), reference-style links
 *   ("[text][ref]") and their definition lines ("[ref]: url"), autolinks and
 *   bare URLs.
 */
/**
 * "[text][ref]" is a reference-style link unless it is really citation markers
 * or labels side by side: the first bracket names a chunk, or the second
 * bracket names a chunk or a tier. Link text that happens to be a tier word
 * ("[Testimony][1]") is still a link.
 */
const CITATION_IN_BRACKET = '(?![^\\]\\n]*\\bchunk\\b)';
const LABEL_OR_CITATION_IN_BRACKET = `(?![^\\]\\n]*\\bchunk\\b)(?!\\s*${TIER_WORD}\\s*\\])`;

const LINK_DEFINITION_SOURCE = String.raw`(?:^|(?<=\n)) {0,3}\[[^\]\n]+\]:[ \t]*(?:<[^>\n]*>|[^\s<>]+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*(?=\n|$)`;

const PROTECTED_SEGMENT_SOURCES: string[] = [
  '(?:^|\\n) {0,3}(?<fence>`{3,}|~{3,})[^\\n]*(?:\\n[\\s\\S]*?\\n {0,3}\\k<fence>[`~]*[ \\t]*(?=\\n|$)|[\\s\\S]*$)',
  '(?<ticks>`+)(?:(?!\\k<ticks>)[^\\n]|\\n(?!\\n))+?\\k<ticks>',
  '(?:^|(?<=\\n))(?: {4,}|\\t)[^\\n]*',
  '\\[[^\\]\\n]*\\]\\([^)\\s]*(?:\\s+"[^"]*")?\\)',
  // A reference-style link, but never two citation markers side by side.
  `\\[${CITATION_IN_BRACKET}[^\\]\\n]*\\]\\[${LABEL_OR_CITATION_IN_BRACKET}[^\\]\\n]*\\]`,
  // A link definition line: "[ref]: destination" with at most a quoted title.
  LINK_DEFINITION_SOURCE,
  '<https?:\\/\\/[^>\\s]+>',
  // An email autolink.
  '<[^@\\s<>]+@[^@\\s<>]+>',
  'https?:\\/\\/[^\\s)\\]>]+',
];

const PROTECTED_SEGMENT = new RegExp(PROTECTED_SEGMENT_SOURCES.join('|'), 'gi');

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reference links whose identifier is declared in the same text ("[ref]: url")
 * are links, whatever the identifier says; protect them for this text.
 */
/** Code only (fences, inline spans, indented lines): the first three protected forms. */
const CODE_ONLY = new RegExp(PROTECTED_SEGMENT_SOURCES.slice(0, 3).join('|'), 'g');

function protectedSegmentFor(markdown: string): RegExp {
  // Definitions inside code are not definitions; blank code out before looking.
  const outsideCode = markdown.replace(CODE_ONLY, (code) => code.replace(/[^\n]/g, ' '));
  const declared = [...outsideCode.matchAll(new RegExp(LINK_DEFINITION_SOURCE, 'g'))]
    .map((m) => /\[([^\]\n]+)\]:/.exec(m[0])?.[1])
    .filter((ref): ref is string => Boolean(ref));
  if (declared.length === 0) return PROTECTED_SEGMENT;
  const refs = declared.map(escapeRegExp).join('|');
  return new RegExp(
    [
      // "[text][ref]" with a declared ref.
      `\\[[^\\]\\n]*\\]\\[\\s*(?:${refs})\\s*\\]`,
      ...PROTECTED_SEGMENT_SOURCES,
      // Shortcut "[ref]" or collapsed "[ref][]" reference links with a declared ref.
      `\\[\\s*(?:${refs})\\s*\\](?:\\[\\])?`,
    ].join('|'),
    'gi'
  );
}

export function readerFacingLabelHits(text: string): string[] {
  const hits: string[] = [];
  if (new RegExp(TIER_ONLY_BRACKET.source, 'i').test(text) || new RegExp(SNAKE_TIER_TOKEN.source, 'i').test(text)) hits.push('grade label');
  if (new RegExp(INTERNAL_STEP_NAME.source, 'i').test(text)) hits.push('internal step');
  // Passage markers are how the writer and the pipeline refer to retrieved text.
  // A reader's citation is a number with a reference behind it.
  if (/\[\s*chunks?\s+\d+(?:\s*,\s*\d+)*\s*\]|\bCHUNK\s+\d+\b/i.test(text)) hits.push('chunk marker');
  if (/\[\s*P\d+(?:\s*[,;]\s*P\d+)*\s*\]/.test(text)) hits.push('passage marker');
  if (/[\[(]\s*(?:established[_ ]fact|strong[_ ]evidence|testimony|inference|speculation)\s*[\])]/i.test(text)) hits.push('grade label');
  if (/\b(?:verdict|case for|case against|falsified|adjudicate)\b/i.test(text)) hits.push('courtroom');
  if (/\bthis report synthesizes evidence\b/i.test(text)) hits.push('boilerplate');
  return hits;
}

/** Marks where a label was removed, so spacing is tidied only there. */
const REMOVED = '\uE000';

function cleanProse(text: string): string {
  return (
    text
      .replace(TIER_INSIDE_BRACKET, '[')
      .replace(TIER_ONLY_BRACKET, REMOVED)
      .replace(SNAKE_TIER_TOKEN, REMOVED)
      .replace(INTERNAL_STEP_NAME, REMOVED)
      // A removal right before punctuation leaves no space: "2023 (x)." -> "2023."
      .replace(/[ \t]*\uE000+[ \t]*(?=[.,;:!?)\]])/g, '')
      // A removal between words leaves one space.
      .replace(/(?<=\S)[ \t]*\uE000+[ \t]*(?=\S)/g, ' ')
      // A removal at the start or end of a line leaves nothing.
      .replace(/[ \t]*\uE000+[ \t]*/g, '')
  );
}

/**
 * Removes evidence-tier labels and internal step names from report text a
 * reader sees. Tier grades remain on stored findings for scoring and for an
 * optional evidence view; they are never part of the report prose. Chunk
 * references ("[Chunk 3]") are kept, because citation mapping reads them.
 * Code in every Markdown form, links and URLs are never changed.
 */
export function stripInternalLabelsFromReport(markdown: string): string {
  let out = '';
  let cursor = 0;
  for (const match of markdown.matchAll(protectedSegmentFor(markdown))) {
    const start = match.index ?? 0;
    out += cleanProse(markdown.slice(cursor, start)) + match[0];
    cursor = start + match[0].length;
  }
  return out + cleanProse(markdown.slice(cursor));
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

function cleanContentFields(row: unknown): unknown {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const source = row as Record<string, unknown>;
  return {
    ...source,
    ...(typeof source.section_title === 'string'
      ? { section_title: stripInternalLabelsFromReport(source.section_title) }
      : {}),
    ...(typeof source.before_content === 'string'
      ? { before_content: stripInternalLabelsFromReport(source.before_content) }
      : {}),
    ...(typeof source.after_content === 'string'
      ? { after_content: stripInternalLabelsFromReport(source.after_content) }
      : {}),
  };
}

/**
 * Revision history shows earlier and later section text to the reader. Clean
 * both sides of every revised section and diff the same way.
 */
export function cleanRevisionForReader<T>(revision: T): T {
  if (!revision || typeof revision !== 'object' || Array.isArray(revision)) return revision;
  const source = revision as Record<string, unknown>;
  return {
    ...source,
    ...(Array.isArray(source.sections) ? { sections: source.sections.map(cleanContentFields) } : {}),
    ...(Array.isArray(source.diffs) ? { diffs: source.diffs.map(cleanContentFields) } : {}),
  } as T;
}
