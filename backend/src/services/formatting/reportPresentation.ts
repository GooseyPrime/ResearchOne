/**
 * Reader-facing clean-up for report text. Kept free of model and database
 * imports so the generator, the read route and the exporters can all use it.
 */
import { REASONING_MODEL_ROLES } from '../reasoning/reasoningModelPolicy';
import { STANDING_FOR_WRITER } from '../authority/authorityTier';
import { looksLikePlanningAnalysis, readerReportTitle, titleFromRequest } from '../research/titleShaping';

const TIER_WORD = '(?:established[_ ]fact|strong[_ ]evidence|testimony|inference|speculation)';
/** "[Strong_Evidence - Chunk 3]" -> "[Chunk 3]"; keeps the chunk reference the citation mapper reads. */
const TIER_INSIDE_BRACKET = new RegExp(`\\[\\s*${TIER_WORD}\\s*[-–—:|,]\\s*(?=[^\\]]*\\bchunk\\b)`, 'gi');
/** "[Strong_Evidence]" or "(strong_evidence)" standing alone. */
const TIER_ONLY_BRACKET = new RegExp(`\\s?(?:\\[\\s*${TIER_WORD}\\s*\\]|\\(\\s*${TIER_WORD}\\s*\\))`, 'gi');
/** Snake-case tier tokens used as labels in running text: "STRONG_EVIDENCE:", "established_fact". */
const SNAKE_TIER_TOKEN = /\b(?:established_fact|strong_evidence)\b:?[ \t]*/gi;

/**
 * RJ-018. A grade written together with where it came from, as older reports
 * printed it after a sentence: "(established_fact, Chunk 17)",
 * "(strong_evidence, Chunks 2, 12, 15)", "(inference, Challenger Findings)",
 * "(speculation, Critical Notes)", "(preserved contradiction, Reasoning Output)".
 *
 * Only this shape matches: a round or square bracket that opens with a grade
 * word and goes on to passage numbers or to the name of one of the system's own
 * working notes. An ordinary parenthesis ("(see Table 2)", "(an inference the
 * authors reject)", "(2019, chapter 3)") is not this shape and is kept.
 */
const GRADE_WITH_ORIGIN = '(?:established[_ ]fact|strong[_ ]evidence|testimony|inference|speculation|preserved[_ ]contradiction|contradiction|unresolved)';
const PASSAGE_NUMBERS = 'chunks?\\s+\\d+(?:\\s*(?:,|;|&|and)\\s*(?:chunks?\\s+)?\\d+)*';
const WORKING_NOTE =
  '(?:challenger?|critical|reasoning|reasoner|retriever|retrieval|planner|verifier|synthesi[sz]er|synthesis|quantitative|discovery|auditor)\\s+(?:findings|notes?|outputs?|analysis|summary|pass)';
const ORIGIN = `(?:${PASSAGE_NUMBERS}|${WORKING_NOTE})`;
const ORIGIN_LIST = `${ORIGIN}(?:\\s*[,;]\\s*${ORIGIN})*`;
const GRADE_AND_ORIGIN_LABEL = new RegExp(
  `(\\s?)(?:\\(\\s*${GRADE_WITH_ORIGIN}\\s*[,;:|\u2013\u2014-]\\s*${ORIGIN_LIST}\\s*\\)|\\[\\s*${GRADE_WITH_ORIGIN}\\s*[,;:|\u2013\u2014-]\\s*${ORIGIN_LIST}\\s*\\])`,
  'gi'
);
/** A working note named alone in brackets: "(Challenger Findings)", "[Reasoning Output]". */
const WORKING_NOTE_LABEL = new RegExp(`\\s?(?:\\(\\s*${WORKING_NOTE}\\s*\\)|\\[\\s*${WORKING_NOTE}\\s*\\])`, 'gi');
/** "(preserved contradiction)" standing alone. The other grades alone are `TIER_ONLY_BRACKET`. */
const PRESERVED_CONTRADICTION_LABEL = /\s?(?:\(\s*preserved[_ ]contradiction\s*\)|\[\s*preserved[_ ]contradiction\s*\])/gi;

/**
 * What a grade-and-origin label becomes. The passage numbers are kept, in the
 * form the citation mapper reads ("[Chunks 2, 12, 15]"), because they are the
 * report's citations; the grade and any working-note name are dropped.
 */
function gradeAndOriginReplacement(label: string, lead: string): string {
  const numbers = [...label.matchAll(/chunks?\s+((?:\d+)(?:\s*(?:,|;|&|and)\s*(?:chunks?\s+)?\d+)*)/gi)]
    .flatMap((match) => match[1].split(/\s*(?:,|;|&|and)\s*(?:chunks?\s+)?/i))
    .map((number) => number.trim())
    .filter((number) => /^\d+$/.test(number));
  if (numbers.length === 0) return REMOVED_LABEL;
  const unique = [...new Set(numbers)];
  // The space before the label, if there was one, stays: labels written side by side stay side by side.
  return `${lead}[${unique.length > 1 ? 'Chunks' : 'Chunk'} ${unique.join(', ')}]`;
}
const REMOVED_LABEL = '\uE000';

/**
 * RJ-018. Section names of the removed layout written inside a sentence
 * ("see Recommended Next Queries"), in the capitals the old layout gave them.
 * Only the names nobody else uses are read here; the one-word names are
 * ordinary words and are mapped only where they stand as a heading.
 */
const OLDER_SECTION_NAMES_IN_TEXT: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bRecommended Next Queries\b/g, 'Further questions'],
  [/\bContested Zones?\b/g, 'Where sources disagree'],
  [/\bContradiction Analysis\b/g, 'Where sources disagree'],
  [/\bEvidence Ledger\b/g, 'What the sources show'],
  [/\bPrimary Evidence\b/g, 'What the sources show'],
  [/\bFalsification Criteria\b/g, 'What would change these findings'],
];

/**
 * Bracketed names of the system's own roles, in any case, with underscores or
 * spaces: "[Quantitative_Quality_Auditor]", "[section drafter]". Only names
 * from the role list match, so a bracketed name such as "[New_York_Times]" is
 * left alone.
 */
const ROLE_NAME_PATTERN = REASONING_MODEL_ROLES.map((role) => role.split('_').join('[_ ]')).join('|');
const INTERNAL_STEP_NAME = new RegExp(`\\s?\\[\\s*(?:${ROLE_NAME_PATTERN})\\s*\\]`, 'gi');

/**
 * The same role names written into a sentence as the one who said something
 * ("as noted by the quantitative quality auditor", "the contract auditor
 * flagged"). Only names of two or more words are read: a one-word role
 * ("planner", "verifier") is also an ordinary word. And only where the sentence
 * credits the role with a finding: several of these names are real occupations,
 * and a report about what a contract auditor or a market scout does must be
 * able to say so. The match is the role name alone, so it can be replaced in place.
 */
const SPOKEN_ROLE_PATTERN = REASONING_MODEL_ROLES.filter((role) => role.includes('_'))
  .map((role) => role.split('_').join('[_ ]'))
  .join('|');
const ROLE_SAYS =
  '(?:notes?|noted|finds?|found|flags?|flagged|identifie[sd]|reports?|reported|observe[sd]|concludes?|concluded|states?|stated|determine[sd]|confirms?|confirmed|warns?|warned|raise[sd]|points?\\s+out|pointed\\s+out|highlights?|highlighted|cautions?|cautioned|verifie[sd]|agent|stage|step|pass)';
const ROLE_EMPHASIS = '(?:\\*\\*|__|\\*|_)?';
const ROLE_NAME = new RegExp(
  `(?<![\\p{L}\\p{N}_])${ROLE_EMPHASIS}(?:the\\s+)?(${SPOKEN_ROLE_PATTERN})(?=\\b|_{1,2}(?:\\W|$))${ROLE_EMPHASIS}`,
  'giu'
);
const SAYS_NEXT = new RegExp(`^\\s+${ROLE_SAYS}\\b`, 'i');
const CREDIT_BEFORE = /\b(?:by|from|per|according\s+to)\s$/i;
/** Text that ends where a sentence starts: the start, a sentence end or a new line, then any list marker and opening punctuation. */
const SENTENCE_START = /(?:^|[.!?]\s+|\n)\s*(?:(?:[-*+]|\d+[.)])\s+)?["'\u201C\u2018([]*$/;

/** Whether the text before `offset` ends where a sentence starts. */
export function startsSentence(whole: string, offset: number): boolean {
  return SENTENCE_START.test(whole.slice(0, offset));
}

/**
 * Pipeline roles credited in a sentence, replaced by what `swap` returns. A
 * name counts only where the sentence credits it (after "by", "from", "per" or
 * "according to", or before a verb of saying). Without "the" it needs one more
 * sign that it is a name and not an occupation: it follows one of those
 * prepositions, it is written as a title ("Quantitative Quality Auditor"), or
 * it opens the sentence. "A highly experienced contract auditor reports to the
 * board" has none of these and is left as written.
 */
export function replaceSpokenRoles(text: string, swap: (sentenceStart: boolean) => string): string {
  return text.replace(ROLE_NAME, (match: string, name: string, offset: number, whole: string) => {
    const afterCredit = CREDIT_BEFORE.test(whole.slice(0, offset));
    const says = SAYS_NEXT.test(whole.slice(offset + match.length));
    if (!afterCredit && !says) return match;
    const sentenceStart = startsSentence(whole, offset);
    const hasArticle = /^(?:(?:\*{1,2}|_{1,2}))?the\s+/i.test(match);
    const titled = name.split(/[_ ]/).every((word) => /^\p{Lu}/u.test(word));
    if (!hasArticle && !afterCredit && !titled && !sentenceStart) return match;
    return swap(sentenceStart);
  });
}

/** Whether a sentence in the text credits a pipeline role. */
export function namesSpokenRole(text: string): boolean {
  let found = false;
  replaceSpokenRoles(text, () => {
    found = true;
    return '';
  });
  return found;
}

/**
 * "Claim" in the sense the report standard bans: a word for what a source or
 * the report says. The same word names other things a report may be about (a
 * patent claim, an insurance claim, a land claim, to claim a refund); those are
 * the subject's own terms and are left alone.
 */
const CLAIM_AS_SUBJECT_TERM =
  '(?:(?:[\\p{L}]+-)*(?:patent|insurance|health|nutrition|warranty|tax|land|territorial|benefits?|expenses?|damages?|compensation|legal|court|medical|disability|unemployment|refund|asylum|mining|small|copyright|trademark|liability|injury|negligence|malpractice|fraud|defamation|libel|pension|welfare|accident|property|title|ownership|sovereignty|maritime|wage|discrimination|harassment|antitrust|breach|contract|civil|action|creditors?|bankruptcy|debt|estate|inheritance|treaty|medicare|medicaid|advertising|infringement|indemnity|salvage|water|native|aboriginal))';
const CLAIM_OBJECT = '(?:adjusters?|forms?|numbers?|a\\s+refund|damages|compensation|asylum|benefits)';
/** After "claims that": the words that make "that" a relative pronoun ("insurance claims that were denied"), so "claims" is still the noun. */
const RELATIVE_AFTER_THAT = '(?:were|was|are|is|have|has|had|remain|remains|could|would|may|might|can|will|did|do|does)';
export const CLAIM_WORD = new RegExp(
  '(?:' +
    // The noun, unless it is one of the subject's own compounds.
    `(?<!\\b${CLAIM_AS_SUBJECT_TERM}\\s)\\bclaims?\\b(?!\\s+${CLAIM_OBJECT})` +
    // The verb is never part of a compound: "the contract claims that the price
    // is fixed" and "the fraud claimed that" are the report saying what a source says.
    `|(?<=\\b${CLAIM_AS_SUBJECT_TERM}\\s)claims?\\b(?=\\s+that\\b(?!\\s+${RELATIVE_AFTER_THAT}\\b))` +
    `|\\bclaim(?:ed|ing)\\b(?!\\s+${CLAIM_OBJECT})` +
    ')',
  'giu'
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
export function mapOutsideCode(markdown: string, change: (text: string) => string, code: (segment: string) => string = (segment) => segment): string {
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
  const proseOf = (source: string): string => {
    let prose = '';
    mapCitationProse(source, (part) => {
      prose += `${part}\uE004`;
      return part;
    });
    // The label of a link is read by the reader too; its destination is not.
    const outsideCode = mapOutsideCode(source, (part) => part, () => '\uE004');
    for (const link of outsideCode.matchAll(INLINE_LINK)) prose += `[${link[1]}]\uE004`;
    // Likewise the label of a reference-style link ("[label][ref]").
    for (const link of outsideCode.matchAll(/\[([^\]\n]*)\]\[[^\]\n]*\]/g)) prose += `[${link[1]}]\uE004`;
    return prose;
  };
  // Labels and markers are a leak wherever they are printed, the reference list included.
  const prose = proseOf(text);
  if (new RegExp(TIER_ONLY_BRACKET.source, 'i').test(prose) || new RegExp(SNAKE_TIER_TOKEN.source, 'i').test(prose)) hits.push('grade label');
  if (new RegExp(INTERNAL_STEP_NAME.source, 'i').test(prose)) hits.push('internal step');
  // Passage markers are how the writer and the pipeline refer to retrieved text.
  // A reader's citation is a number with a reference behind it.
  if (/\[\s*chunks?\s+\d+(?:\s*,\s*\d+)*\s*\]|\bCHUNK\s+\d+\b/i.test(prose)) hits.push('chunk marker');
  // Closed or not: "[P1" left open is still a marker on the page.
  if (/\[\s*P\d+\b/i.test(prose)) hits.push('passage marker');
  if (/[\[(]\s*(?:established[_ ]fact|strong[_ ]evidence|testimony|inference|speculation)\s*[\])]/i.test(prose)) hits.push('grade label');
  if (!hits.includes('grade label') && (new RegExp(GRADE_AND_ORIGIN_LABEL.source, 'i').test(prose) || new RegExp(PRESERVED_CONTRADICTION_LABEL.source, 'i').test(prose))) hits.push('grade label');
  if (!hits.includes('internal step') && new RegExp(WORKING_NOTE_LABEL.source, 'i').test(prose)) hits.push('internal step');
  // Every check of wording reads the report's own sentences. A reference entry
  // is a source's title and publisher, which the report did not write: a source
  // called "The Case for Nuclear Power" is not courtroom wording.
  const own = withoutReferenceList(text);
  const body = readerVisibleText(own);
  // Phrases are read as the reader sees them: a link shows its label in place,
  // so "This [report](url) synthesizes evidence" is the banned phrase.
  const seen = `${proseOf(own)}\uE004${body}`;
  if (/\b(?:verdict|case for|case against|falsified|adjudicate|the evidence establishes|testimony[- ]tier)\b/i.test(seen)) hits.push('courtroom');
  // A role named in a sentence is an internal step on the page, brackets or not.
  if (namesSpokenRole(body) && !hits.includes('internal step')) hits.push('internal step');
  // What a source says in its own words stays as it said it; the report's own wording is checked.
  let ownWords = '';
  mapOutsideQuotes(body, (part) => {
    ownWords += `${part}\uE004`;
    return part;
  });
  if (new RegExp(CLAIM_WORD.source, 'iu').test(ownWords)) hits.push('claims wording');
  if (/\bthis report synthesizes evidence\b/i.test(seen)) hits.push('boilerplate');
  if (SOURCE_RANK_LABEL.test(ownWords)) hits.push('source rank');
  return hits;
}

/** Marks where a label was removed, so spacing is tidied only there. */
const REMOVED = '\uE000';

/**
 * Slice 6. The line the writer is shown above each passage ("Kind of source:
 * peer-reviewed scholarly work"). It is an instruction to the writer, so a copy
 * of it in the report is removed whole. Only the exact lines the writer is
 * shown match, with or without a list marker, so a sentence of the report that
 * happens to begin "Kind of source:" is kept.
 */
const escapeForPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WRITER_SOURCE_KIND_LINE = new RegExp(
  `^[ \\t]*(?:(?:[-*+>]|\\d+[.)])[ \\t]+)?Kind of source:[ \\t]*(?:${Object.values(STANDING_FOR_WRITER).map(escapeForPattern).join('|')})[ \\t]*\\.?[ \\t]*$`,
  'i'
);

/**
 * Removes whole copied standing lines. Judged line by line on the whole text,
 * not on the pieces between links and code, so a line that merely starts the
 * same way and goes on past a link is kept. Code in every form the shared
 * matcher knows (fences of any length, inline spans, indented lines) is blanked
 * out before judging, so a line that is code, or holds any code, is kept.
 */
function dropWriterSourceKindLines(markdown: string): string {
  if (!/Kind of source:/i.test(markdown)) return markdown;
  const lines = markdown.split('\n');
  const outsideCode = markdown.replace(CODE_ONLY, (code) => code.replace(/[^\n]/g, ' ')).split('\n');
  return lines.filter((line, at) => !(outsideCode[at] === line && WRITER_SOURCE_KIND_LINE.test(line))).join('\n');
}

/**
 * Slice 6. A sentence that ranks a source by tier number ("a tier 1 source",
 * "sources in tier 2", "T1 evidence"). A tier is never printed in report text
 * (plan, slice 6); this is the check that it is not. Only a tier number tied
 * to a source, a study, a record or evidence counts, so "tier 2 cities" or a
 * "tier 1 supplier" is prose.
 */
const SOURCE_RANK_LABEL = new RegExp(
  [
    '\\b(?:authority[- ])?(?:tier|level)[- ]?[1-4]\\s+(?:sources?|evidence|records?|stud(?:y|ies)|references?|documents?|citations?)\\b',
    '\\b(?:sources?|records?|stud(?:y|ies)|references?|evidence)\\s+(?:of|at|in|from)\\s+(?:authority\\s+)?(?:tier|level)[- ]?[1-4]\\b',
    '\\bT[1-4]\\s+(?:sources?|evidence|records?|stud(?:y|ies))\\b',
    '\\bauthority\\s+(?:tier|level)\\b',
  ].join('|'),
  'i'
);

/**
 * Sentences the layout removed on 8 Oct 2026 wrote by itself into a report's
 * summary: counts of sources and passages, and stock lines about conflicts. No
 * reader is shown them, in a report of any age. A report can still discuss its
 * subject in any of these words; only these whole sentences are taken out.
 */
const MACHINE_SENTENCES: readonly RegExp[] = [
  /This report synthesizes evidence from \d+ sources? and \d+ evidence chunks?[^.\n]*\.[ \t]*/gi,
  /The current evidence set does not surface explicit contradiction pairs[^.\n]*\.[ \t]*/gi,
  /[^.\n]*conclusions remain conditional on corpus coverage\.[ \t]*/gi,
  /The findings include \d+ explicit contradiction points?[^.\n]*\.[ \t]*/gi,
];

export function withoutMachineSentences(text: string): string {
  return MACHINE_SENTENCES.reduce((out, pattern) => out.replace(pattern, ''), text);
}

function withReaderSectionNames(text: string): string {
  return OLDER_SECTION_NAMES_IN_TEXT.reduce((out, [was, now]) => out.replace(was, now), text);
}

function cleanProse(text: string, keepSectionNames = false): string {
  return (
    (keepSectionNames ? withoutMachineSentences(text) : withReaderSectionNames(withoutMachineSentences(text)))
      // Before the single-grade rules: they would take the grade and leave "(, Chunk 17)".
      .replace(GRADE_AND_ORIGIN_LABEL, gradeAndOriginReplacement)
      .replace(WORKING_NOTE_LABEL, REMOVED)
      .replace(PRESERVED_CONTRADICTION_LABEL, REMOVED)
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
export function stripInternalLabelsFromReport(text: string, options: { keepSectionNames?: boolean } = {}): string {
  const markdown = dropWriterSourceKindLines(text);
  let out = '';
  let cursor = 0;
  for (const match of markdown.matchAll(protectedSegmentFor(markdown))) {
    const start = match.index ?? 0;
    out += cleanProse(markdown.slice(cursor, start), options.keepSectionNames) + match[0];
    cursor = start + match[0].length;
  }
  return out + cleanProse(markdown.slice(cursor), options.keepSectionNames);
}

/**
 * A stored heading with its labels removed and its name as stored. A heading
 * is mapped to reader words by `readerHeading`, which also has to recognise the
 * old name to mark challenge material; the in-sentence mapping would rename it
 * first and hide that.
 */
const stripHeadingLabels = (title: string): string => stripInternalLabelsFromReport(title, { keepSectionNames: true });

const normHeading = (text: string): string => text.replace(/[\s#*_]+/g, ' ').trim().toLowerCase();

/**
 * Headings of the layout that was removed, and what a reader is shown in their
 * place. A report written before 8 Oct 2026 still has them stored; it is read
 * and exported through the same view as every other report, under these
 * headings. `challenge` marks the ones whose text is challenge material: it is
 * shown on the Challenge pass tab and left out of the report a reader exports.
 * (The reading page carries the same list, so a report is headed the same way
 * whichever side maps it.)
 */
const OLDER_HEADINGS: ReadonlyArray<{ was: RegExp; now: string; challenge?: true }> = [
  // The section's public name until RJ-017; a stored report still carries it.
  { was: /^challenge pass$/, now: 'Double-check', challenge: true },
  { was: /^executive summary$/, now: 'Summary' },
  { was: new RegExp(`^${'fram' + 'ing'}$`), now: 'Background' },
  { was: /^research question( and scope)?$/, now: 'What was asked' },
  { was: /^(primary evidence|evidence ledger)$/, now: 'What the sources show' },
  { was: /^(contested zones?|contradiction analysis)$/, now: 'Where sources disagree' },
  { was: /^unresolved( questions)?$/, now: 'Open questions' },
  { was: /^recommended next queries$/, now: 'Further questions' },
  { was: /^challenges( and alternative explanations)?$/, now: 'Other explanations', challenge: true },
  { was: /^falsification criteria$/, now: 'What would change these findings', challenge: true },
];

const olderHeading = (title: string) => OLDER_HEADINGS.find((entry) => entry.was.test(normHeading(title)));

/** The heading a reader sees for a stored section title. */
export function readerHeading(title: string): string {
  return olderHeading(title)?.now ?? title;
}

/** Whether a stored title is one of the old layout's challenge sections. */
export function isOlderChallengeHeading(title: string): boolean {
  return olderHeading(title)?.challenge === true;
}

/**
 * A section's text without a first line that only repeats its heading. Older
 * reports stored the heading twice, as the title and again at the top of the
 * text, and it was printed twice.
 */
export function withoutRepeatedHeading(title: string, content: string): string {
  const lines = content.split('\n');
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first === -1) return content;
  const line = normHeading(lines[first].replace(/[\s#*_]+/g, ' ').trim().replace(/[:：]\s*$/, ''));
  if (line !== normHeading(title) && line !== normHeading(readerHeading(title))) return content;
  return lines.slice(first + 1).join('\n').replace(/^\n+/, '');
}

/**
 * A stored section as a reader is sent it: labels removed, the heading a reader
 * sees, the heading not repeated in the text, and an old challenge section
 * marked as one so the page puts it on the Challenge pass tab. Returns a copy.
 */
export function presentSectionForReader<S extends Record<string, unknown>>(section: S): S {
  const title = typeof section.title === 'string' ? stripHeadingLabels(section.title) : null;
  const content = typeof section.content === 'string' ? stripInternalLabelsFromReport(section.content) : null;
  return {
    ...section,
    ...(title !== null ? { title: readerHeading(title) } : {}),
    ...(content !== null ? { content: title !== null ? withoutRepeatedHeading(title, content) : content } : {}),
    ...(title !== null && isOlderChallengeHeading(title) ? { section_type: 'challenge' } : {}),
  };
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
      // The cards of the removed layout (counts of conflicts and passages, a
      // template sentence about what would overturn the report). An older
      // report still has them stored; none is sent to a reader.
      metric_glosses: [],
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

/**
 * One mapper for every reader-facing projection of a report (slice 5, item 11).
 *
 * Any response that carries report text to a reader goes through this: the
 * report, its list row, a dossier card, a revision, a spinoff prefill. It walks
 * the response and cleans the fields a reader is shown, by name, wherever they
 * sit. What a person typed (the question, their notes) is never touched.
 * Returns a copy; the stored rows are not rewritten.
 */
const READER_TEXT_FIELDS: ReadonlySet<string> = new Set([
  'report_title',
  'reportTitle',
  'display_title',
  'displayTitle',
  'run_display_title',
  'runDisplayTitle',
  'executive_summary',
  'conclusion',
  'falsification_criteria',
  'content',
  'section_title',
  'before_content',
  'after_content',
  'plain_language_markdown',
  'overall_summary',
  'conclusions_nutshell',
]);
/** Fields whose every text value is reader text, whatever its key: lists a report shows as written. */
const READER_TEXT_GROUPS: ReadonlySet<string> = new Set(['metric_glosses', 'unresolved_questions', 'recommended_queries']);
const PRESENT_DEPTH = 8;
/** Where a row carries the request it answers, under the names the routes use. */
const REQUEST_FIELDS = ['query', 'request_query', 'requestQuery'] as const;
const REPORT_TITLE_FIELDS: ReadonlySet<string> = new Set(['report_title', 'reportTitle']);
const RUN_TITLE_FIELDS: ReadonlySet<string> = new Set(['display_title', 'displayTitle', 'run_display_title', 'runDisplayTitle']);
/** A section's `title` is its heading, which has its own mapping; only a report's `title` falls back on the request. */
const isSectionRow = (row: Record<string, unknown>): boolean =>
  'section_order' in row || 'section_type' in row || ('content' in row && !('executive_summary' in row) && !('query' in row));

export interface PresentOptions {
  /**
   * What `title` holds in this response. A report's and a section's title is
   * report text. A run's title is the question as the person typed it, and a
   * source's title is the publisher's: neither is ours to rewrite.
   */
  title: 'report' | 'not-report';
  /**
   * Where a response mixes the two: keys that hold a report (or a list of
   * them), under which a `title` is the report's even though elsewhere in the
   * response it is not.
   */
  reportTitleUnder?: readonly string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function presentValue(value: unknown, depth: number, everyString: boolean, options: PresentOptions, titleIsReports: boolean): unknown {
  if (typeof value === 'string') return everyString ? stripInternalLabelsFromReport(value) : value;
  if (depth >= PRESENT_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => presentValue(item, depth + 1, everyString, options, titleIsReports));
  if (!isPlainRecord(value)) return value;
  const out: Record<string, unknown> = {};
  // The request this row answers, where the row carries it: what a title falls back on.
  const request = REQUEST_FIELDS.map((field) => value[field]).find((held): held is string => typeof held === 'string' && held.trim().length > 0) ?? null;
  for (const [key, held] of Object.entries(value)) {
    const readerText = READER_TEXT_FIELDS.has(key) || (key === 'title' && titleIsReports);
    // A section named in a revision's history is headed as the report page heads it.
    if (typeof held === 'string' && key === 'section_title') out[key] = readerHeading(stripHeadingLabels(held));
    // A report's title is never an old section name; with the request at hand it is a title of the request.
    else if (typeof held === 'string' && (REPORT_TITLE_FIELDS.has(key) || (key === 'title' && titleIsReports && !isSectionRow(value)))) {
      out[key] = readerReportTitle(stripInternalLabelsFromReport(held), request) ?? '';
    }
    // A run's title is never the planning step's analysis of the request.
    else if (typeof held === 'string' && RUN_TITLE_FIELDS.has(key)) {
      const cleaned = stripInternalLabelsFromReport(held);
      out[key] = looksLikePlanningAnalysis(cleaned) ? titleFromRequest(request) : cleaned;
    }
    else if (typeof held === 'string') out[key] = everyString || readerText ? stripInternalLabelsFromReport(held) : held;
    else out[key] = presentValue(held, depth + 1, everyString || READER_TEXT_GROUPS.has(key), options, titleIsReports || (options.reportTitleUnder?.includes(key) ?? false));
  }
  return out;
}

export function presentForReader<T>(response: T, options: PresentOptions = { title: 'report' }): T {
  return presentValue(response, 0, false, options, options.title === 'report') as T;
}

/** A revised section as it is stored: the same clean-up, applied on write. */
export function cleanSectionForStorage<S extends { title: string; content: string }>(section: S): S {
  return { ...section, title: stripInternalLabelsFromReport(section.title), content: stripInternalLabelsFromReport(section.content) };
}
