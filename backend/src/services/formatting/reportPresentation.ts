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
 * The same role names written into a sentence without brackets ("as noted by
 * the quantitative quality auditor"). Only names of two or more words are read:
 * a one-word role ("planner", "verifier") is also an ordinary word.
 */
const SPOKEN_ROLE_PATTERN = REASONING_MODEL_ROLES.filter((role) => role.includes('_'))
  .map((role) => role.split('_').join('[_ ]'))
  .join('|');
export const SPOKEN_ROLE_NAME = new RegExp(`\\b(?:the\\s+)?(?:${SPOKEN_ROLE_PATTERN})\\b`, 'gi');

/**
 * "Claim" in the sense the report standard bans: a word for what a source or
 * the report says. The same word names other things a report may be about (a
 * patent claim, an insurance claim, a land claim, to claim a refund); those are
 * the subject's own terms and are left alone.
 */
const CLAIM_AS_SUBJECT_TERM =
  '(?:patent|insurance|health|nutrition|warranty|tax|land|territorial|benefits?|expenses?|damages?|compensation|legal|court|medical|disability|unemployment|refund|asylum|mining|small)';
export const CLAIM_WORD = new RegExp(
  `(?<!\\b${CLAIM_AS_SUBJECT_TERM}\\s)\\bclaim(?:s|ed|ing)?\\b(?!\\s+(?:adjusters?|forms?|numbers?|a\\s+refund|damages|compensation|asylum|benefits))`,
  'gi'
);

/** A direct quotation is the source's wording, not the report's. Short spans only, inside one paragraph. */
const QUOTED_SPAN = /"[^"\n]{1,600}"|\u201C[^\u201D\n]{1,600}\u201D/g;

/** Apply a change to everything outside double quotation marks. */
export function mapOutsideQuotes(text: string, change: (part: string) => string): string {
  let out = '';
  let cursor = 0;
  for (const match of text.matchAll(QUOTED_SPAN)) {
    const start = match.index ?? 0;
    out += change(text.slice(cursor, start)) + match[0];
    cursor = start + match[0].length;
  }
  return out + change(text.slice(cursor));
}

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

/** Two or more citation brackets side by side ("[1][2]", "[P1][P2]") are citations, not a reference link. */
const CITATION_RUN = /^(?:\[\s*P?\d+(?:\s*[,;]\s*P?\d+)*\s*\]){2,}$/i;
/** A passage marker written as the text of a link is still a citation. */
const MARKER_AS_LINK_TEXT = /^\[\s*P\d+[^\]\n]*\]\(/i;
/**
 * So is one that a link definition ("[P1]: url") turns into a shortcut or
 * collapsed reference link. The definition line itself stays protected. The
 * older citation forms ("[E1]", "[Chunk 4]") are released the same way, so a
 * definition cannot hide one from the checks and clean-ups that read prose.
 */
const MARKER_AS_REFERENCE_LINK = /^\[\s*(?:P\d+|E\d+|(?:see\s+)?chunks?\s+\d+)[^\]\n]*\](?:\[[^\]\n]*\])?$/i;
/** A bare number is a reader's citation even when a "[1]: url" line would make it a shortcut link, spaced ("[ 1 ]") or grouped ("[1, 2]") forms included. */
const NUMBER_AS_REFERENCE_LINK = /^\[\s*\d+(?:\s*(?:[,;/&+\u2013\u2014-]|and|to)\s*\d+)*\s*\](?:\[\])?$/;

/** Width of leading whitespace, a tab counting as four columns. */
function indentWidth(line: string): number {
  return (/^[ \t]*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length;
}

const LIST_ITEM_LINE = /^([ \t]*)((?:[-*+]|\d+[.)])[ \t]+)/;

/**
 * The column where the text of the list item holding this line begins, or null
 * when no list item holds it. Looking back, an item holds the line only if
 * every line in between is indented at least as far as that item's text; a
 * shallower line in between has already closed the item.
 */
function containingItemColumn(markdown: string, at: number, lineIndent: number): number | null {
  const before = markdown.slice(0, at).split('\n');
  // A segment can begin with the line break before its line.
  if (!markdown.startsWith('\n', at)) before.pop();
  let shallowest = lineIndent;
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const line = before[index];
    if (/^\s*$/.test(line)) continue;
    const indent = indentWidth(line);
    const item = LIST_ITEM_LINE.exec(line);
    if (item) {
      const column = indent + item[2].length;
      if (column <= shallowest) return column;
    } else if (indent === 0) {
      return null;
    }
    shallowest = Math.min(shallowest, indent);
  }
  return null;
}

/**
 * Whether an indented line is prose nested in a list, by where it sits and not
 * by what it says. Inside a list item, a nested item is prose, and so is a
 * continuation line; a line four or more columns past where the item's text
 * begins is a code block inside the item, as Markdown reads it. With no list
 * item holding it, an indented line is code.
 */
function nestedListProse(markdown: string, segment: string, at: number): boolean {
  if (!/^(?: {4,}|\t)/.test(segment)) return false;
  const indent = indentWidth(segment);
  const column = containingItemColumn(markdown, at, indent);
  if (column === null) return false;
  if (LIST_ITEM_LINE.test(segment)) return true;
  return indent < column + 4;
}

/**
 * Apply a change to the prose of a report and to nothing else. Code in every
 * Markdown form, links, link definitions and URLs are returned as written, so a
 * number in brackets inside them is never read as a citation or removed.
 */
export function mapCitationProse(markdown: string, change: (prose: string) => string): string {
  let out = '';
  let cursor = 0;
  for (const match of markdown.matchAll(protectedSegmentFor(markdown))) {
    const segment = match[0];
    if (nestedListProse(markdown, segment, match.index ?? 0)) {
      // Nested prose: read the line itself, so code and links inside it stay protected.
      const start = match.index ?? 0;
      const indent = /^[ \t]*/.exec(segment)?.[0] ?? '';
      out += change(markdown.slice(cursor, start)) + indent + mapCitationProse(segment.slice(indent.length), change);
      cursor = start + segment.length;
      continue;
    }
    if (
      CITATION_RUN.test(segment) ||
      MARKER_AS_LINK_TEXT.test(segment) ||
      MARKER_AS_REFERENCE_LINK.test(segment) ||
      NUMBER_AS_REFERENCE_LINK.test(segment)
    ) {
      // Released, not protected: the cursor stays put, so the segment is handed
      // to `change` once, inside the next prose span, joined to the words around
      // it. Passing it alone would cut the sentence it cites in two.
      continue;
    }
    const start = match.index ?? 0;
    out += change(markdown.slice(cursor, start)) + match[0];
    cursor = start + match[0].length;
  }
  return out + change(markdown.slice(cursor));
}

/** An inline link, with its label captured. */
const INLINE_LINK = /\[([^\]\n]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g;
/**
 * A link whose whole label is a citation: a small number, a passage marker, an
 * export alias or a chunk marker, written as an inline link or as a reference
 * link with a label of its own.
 */
const CITATION_AS_LINK =
  /\[(\s*(?:\d{1,3}|P\d+\b[^\]\n]*|E\d+|(?:see\s+)?chunks?\s+\d+[^\]\n]*)\s*)\](?:\([^)\s]*(?:\s+"[^"]*")?\)|\[(?!\s*(?:P?\d+|E\d+)\s*[\],;])[^\]\n]*\])/gi;

/**
 * Turn "[1](url)" into "[1]" outside code, so a citation written as a link is
 * read as the citation the reader takes it for. A longer number ("[2023](url)")
 * is an ordinary link and is left alone.
 */
export function unwrapCitationLinks(markdown: string): string {
  return mapOutsideCode(markdown, (text) => text.replace(CITATION_AS_LINK, '[$1]'));
}

/**
 * Apply a change to everything that is not code. An indented line nested in a
 * list is prose, so it is read too, with any inline code inside it still kept.
 * `code` says what a code segment becomes; by default it is left as written.
 */
function mapOutsideCode(markdown: string, change: (text: string) => string, code: (segment: string) => string = (segment) => segment): string {
  let out = '';
  let cursor = 0;
  for (const match of markdown.matchAll(CODE_ONLY)) {
    const start = match.index ?? 0;
    const segment = match[0];
    out += change(markdown.slice(cursor, start));
    if (nestedListProse(markdown, segment, start)) {
      const indent = /^[ \t]*/.exec(segment)?.[0] ?? '';
      out += indent + mapOutsideCode(segment.slice(indent.length), change, code);
    } else {
      out += code(segment);
    }
    cursor = start + segment.length;
  }
  return out + change(markdown.slice(cursor));
}

/**
 * Apply a change to the label of every link outside code: the "label" of
 * "[label](destination)" and of "[label][ref]". Destinations, identifiers and
 * code are returned as written.
 */
export function mapLinkLabels(markdown: string, change: (label: string) => string): string {
  return mapOutsideCode(markdown, (text) =>
    text
      .replace(/\[([^\]\n]*)\](\([^)\s]*(?:\s+"[^"]*")?\))/g, (_full, label: string, destination: string) => `[${change(label)}]${destination}`)
      .replace(/\[([^\]\n]*)\](\[[^\]\n]+\])/g, (_full, label: string, ref: string) => `[${change(label)}]${ref}`)
  );
}

/**
 * The text as a reader sees it: each inline link replaced by its label where it
 * stands, and code, link definitions and bare addresses taken out.
 */
function readerVisibleText(text: string): string {
  return mapOutsideCode(text, (part) => part, () => '\uE004')
    .replace(INLINE_LINK, '$1')
    // A reference-style link shows its label; the identifier after it is never seen.
    .replace(/\[([^\]\n]*)\]\[[^\]\n]*\]/g, '$1')
    .replace(new RegExp(LINK_DEFINITION_SOURCE, 'g'), '\uE004')
    .replace(/<https?:\/\/[^>\s]+>|https?:\/\/[^\s)\]>]+/gi, '\uE004');
}

/**
 * The text without its generated reference list: from the last "References"
 * heading to the next heading. The list is written after the body, so it is the
 * last section of that name; an earlier one is the report's own writing and is
 * checked like any other section.
 */
function withoutReferenceList(text: string): string {
  const lines = text.split('\n');
  let listStart = -1;
  lines.forEach((line, index) => {
    if (/^#{1,6}[ \t]+References[ \t#]*$/i.test(line)) listStart = index;
  });
  if (listStart === -1) return text;
  let listEnd = lines.length;
  for (let index = listStart + 1; index < lines.length; index += 1) {
    if (/^#{1,6}[ \t]+\S/.test(lines[index])) {
      listEnd = index;
      break;
    }
  }
  return [...lines.slice(0, listStart), ...lines.slice(listEnd)].join('\n');
}

export function readerFacingLabelHits(text: string): string[] {
  const hits: string[] = [];
  // Only prose is checked: a code sample or a link that happens to contain a
  // label is not a leak, and the clean-up that removes labels never touches it.
  // Fragments are kept apart, so text on either side of a code span cannot join into a false match.
  let prose = '';
  mapCitationProse(text, (part) => {
    prose += `${part}\uE004`;
    return part;
  });
  // The label of a link is read by the reader too; its destination is not.
  const outsideCode = mapOutsideCode(text, (part) => part, () => '\uE004');
  for (const link of outsideCode.matchAll(INLINE_LINK)) prose += `[${link[1]}]\uE004`;
  // Likewise the label of a reference-style link ("[label][ref]").
  for (const link of outsideCode.matchAll(/\[([^\]\n]*)\]\[[^\]\n]*\]/g)) prose += `[${link[1]}]\uE004`;
  if (new RegExp(TIER_ONLY_BRACKET.source, 'i').test(prose) || new RegExp(SNAKE_TIER_TOKEN.source, 'i').test(prose)) hits.push('grade label');
  if (new RegExp(INTERNAL_STEP_NAME.source, 'i').test(prose)) hits.push('internal step');
  // Passage markers are how the writer and the pipeline refer to retrieved text.
  // A reader's citation is a number with a reference behind it.
  if (/\[\s*chunks?\s+\d+(?:\s*,\s*\d+)*\s*\]|\bCHUNK\s+\d+\b/i.test(prose)) hits.push('chunk marker');
  // Closed or not: "[P1" left open is still a marker on the page.
  if (/\[\s*P\d+\b/i.test(prose)) hits.push('passage marker');
  if (/[\[(]\s*(?:established[_ ]fact|strong[_ ]evidence|testimony|inference|speculation)\s*[\])]/i.test(prose)) hits.push('grade label');
  // Phrases are read as the reader sees them: a link shows its label in place,
  // so "This [report](url) synthesizes evidence" is the banned phrase.
  const seen = `${prose}\uE004${readerVisibleText(text)}`;
  if (/\b(?:verdict|case for|case against|falsified|adjudicate|the evidence establishes|testimony[- ]tier)\b/i.test(seen)) hits.push('courtroom');
  // The two checks below read the report's own sentences. A reference entry is
  // a source's title and publisher, which the report did not write.
  const body = readerVisibleText(withoutReferenceList(text));
  // A role named in a sentence is an internal step on the page, brackets or not.
  if (new RegExp(SPOKEN_ROLE_NAME.source, 'i').test(body) && !hits.includes('internal step')) hits.push('internal step');
  // What a source says in its own words stays as it said it; the report's own wording is checked.
  let ownWords = '';
  mapOutsideQuotes(body, (part) => {
    ownWords += `${part}\uE004`;
    return part;
  });
  if (new RegExp(CLAIM_WORD.source, 'i').test(ownWords)) hits.push('claims wording');
  if (/\bthis report synthesizes evidence\b/i.test(seen)) hits.push('boilerplate');
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
