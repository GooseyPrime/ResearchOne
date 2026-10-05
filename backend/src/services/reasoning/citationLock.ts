/**
 * Citation lock (slice 4, part 1).
 *
 * With the lock on, the section writer is shown passages under markers it must
 * cite by, `[P1]`, `[P2]`. A marker it was not shown is not a source. Before the
 * report is saved, every marker is turned into a reader number — one number per
 * source, in order of first citation — and tied to the passage it came from with
 * a quote copied word for word from that passage.
 *
 * `[P#]` is used while the report is being written and never reaches a reader.
 * It is distinct from the `[E#]` aliases the export engine assigns to saved
 * citations (`formatting/evidenceAliaser.ts`).
 */
import { mapCitationProse, unwrapCitationLinks } from '../formatting/reportPresentation';
import { splitTopLevelSections } from './targetedRepair';
import { buildAbout, buildReferences, formatReadDate, sourceKey, type UsedSource } from './baselineReport';
import type { ReferenceStyle } from '../formatting/referenceList';

export interface LockedPassage {
  /** `P1`, `P2`, … in the order the passages were retrieved. */
  marker: string;
  chunkId: string;
  /** The stored source the passage belongs to, when known. */
  sourceId?: string | null;
  text: string;
  source: UsedSource;
}

export interface CitationOccurrence {
  /** Reader number shown in the text. */
  number: number;
  chunkId: string;
  /** Copied word for word from the passage. */
  quote: string;
}

// A model may write the marker in either case; `[p3]` is the same citation as `[P3]`.
// A model also groups them in ways it was not asked to: "[P1/P2]", "[P1 and P2]",
// "[P1, 2]", "[P1–P3]". Every such bracket is read, so none reaches a reader raw.
const MARKER_GROUP = /\[\s*(P\d+(?:\s*(?:[,;/&+\u2013\u2014-]|and|to)\s*P?\d+)*)\s*\]/gi;
const MARKER_TOKEN = /P?(\d+)|([\u2013\u2014-]|\bto\b)/gi;
/** Any bracket that opens with a passage marker, whatever follows it. */
// A bracket the model never closed ("Claim [P1") is still a marker a reader
// would see. Only the opening token is taken, not the words after it.
// Neither form reaches past the next "[", so a broken marker cannot swallow
// the sentence after it or the valid marker that follows.
const PASSAGE_LOOKING = /[ \t]*\[\s*P\d+\b(?:[^[\]\n]*\]|(?![^[\]\n]*\]))/gi;
/** The pre-lock citation form, in brackets or parentheses. */
const CHUNK_MARKER = /[ \t]*[[(]\s*(?:see\s+)?chunks?\s+\d+(?:\s*(?:,|and)\s*\d+)*\s*[\])]|[ \t]*\b(?:(?:see|in|from|per)\s+)?chunks?\s+\d+(?:\s*(?:,|and)\s*\d+)*\b/gi;
/** The export engine's alias form. It is assigned after a report is saved; a writer that emits it has cited nothing. */
const EXPORT_ALIAS = /[ \t]*\[\s*E\d+(?:\s*[,;]\s*E\d+)*\s*\]/gi;
/** A number in brackets the lock did not issue, alone or grouped ("[1, 2]", "[1 and 2]", "[1-3]"). */
const BARE_NUMBERS = /[ \t]*\[\s*\d+(?:\s*(?:[,;/&+\u2013\u2014-]|and|to)\s*\d+)*\s*\](?!\()/g;
/** A range wider than this is not expanded; its two ends are kept. */
const RANGE_LIMIT = 12;

/** The markers inside one bracket, in the upper-case form passages are issued under. */
function markersOf(inner: string): string[] {
  const out: string[] = [];
  let rangeFrom: number | null = null;
  for (const token of inner.matchAll(MARKER_TOKEN)) {
    if (token[2]) {
      const last = out[out.length - 1];
      rangeFrom = last ? Number(last.slice(1)) : null;
      continue;
    }
    const n = Number(token[1]);
    if (rangeFrom !== null && n > rangeFrom + 1 && n - rangeFrom <= RANGE_LIMIT) {
      for (let between = rangeFrom + 1; between < n; between += 1) out.push(`P${between}`);
    }
    rangeFrom = null;
    out.push(`P${n}`);
  }
  return out;
}

export function issuePassages(
  chunks: Array<{ id: string; content: string }>,
  sources: UsedSource[],
  sourceIdByChunk: ReadonlyMap<string, string | null> = new Map()
): LockedPassage[] {
  return chunks.map((chunk, index) => ({
    marker: `P${index + 1}`,
    chunkId: chunk.id,
    sourceId: sourceIdByChunk.get(chunk.id) ?? null,
    text: chunk.content,
    source: sources[index] ?? { title: 'Untitled source' },
  }));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'were', 'has', 'have', 'had', 'but', 'its',
  'into', 'than', 'then', 'they', 'their', 'there', 'which', 'what', 'when', 'where', 'who', 'how', 'why', 'did', 'does',
  'about', 'between', 'over', 'under', 'also', 'been', 'being', 'can', 'could', 'would', 'should', 'will', 'may',
]);

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((term) => !STOP_WORDS.has(term));
}

function overlap(haystackTerms: Set<string>, needles: string[]): number {
  let hits = 0;
  for (const needle of needles) if (haystackTerms.has(needle)) hits += 1;
  return hits;
}

/** Characters of passage text one section may be shown. */
export const SECTION_CONTEXT_BUDGET = 60_000;
/** Passages a subject section is shown when there are more than fit its topic. */
export const SECTION_PASSAGE_LIMIT = 12;

/**
 * The passages one section is shown. While the retrieved passages fit the budget
 * every section sees all of them, so nothing the analysis stages read is hidden
 * from the writer. When they do not fit, a section that covers the whole report
 * sees as many as fit, and a subject section sees the ones closest to its heading
 * and the request. Passages keep their retrieval order and their markers.
 */
export function passagesForSection(
  passages: LockedPassage[],
  hints: string[],
  options: { broad: boolean; limit?: number; budget?: number }
): LockedPassage[] {
  const budget = options.budget ?? SECTION_CONTEXT_BUDGET;
  const limit = options.limit ?? SECTION_PASSAGE_LIMIT;
  const hintTerms = terms(hints.join(' '));
  const ranked = passages
    .map((passage, index) => ({ passage, index, score: overlap(new Set(terms(passage.text)), hintTerms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const total = passages.reduce((sum, passage) => sum + passage.text.length, 0);
  // Everything is shown while it fits. Only a corpus too large for one prompt is narrowed.
  const candidates = options.broad || total <= budget || passages.length <= limit ? ranked : ranked.slice(0, limit);
  const chosen: Array<{ passage: LockedPassage; index: number }> = [];
  let used = 0;
  for (const candidate of candidates) {
    const size = candidate.passage.text.length;
    if (chosen.length > 0 && used + size > budget) continue;
    chosen.push(candidate);
    used += size;
  }
  return chosen.sort((a, b) => a.index - b.index).map((entry) => entry.passage);
}

/** What the writer reads: each passage whole, under the marker it must cite by. */
export function formatLockedContext(passages: LockedPassage[], cleanText: (text: string) => string = (text) => text): string {
  if (passages.length === 0) return 'No passages are available. State nothing that would need a source.';
  return passages
    .map((passage) => {
      // A source can contain "[P2]" of its own (a footnote, a title). Shown as
      // written it would look like a marker the writer may cite. Round brackets
      // keep the text readable and cannot be read as a marker; the stored
      // passage, which quotes are copied from, is untouched.
      const unmark = (text: string): string => text.replace(/\[(\s*P\d+\b[^\]\n]*)\]/gi, '($1)').replace(/\[(?=\s*P\d+\b)/gi, '(');
      // Title and publisher come from the source too, and sit on the marker's
      // own line: kept to one line, so they cannot start a line that looks like a header.
      const from = [passage.source.publisher, passage.source.title]
        .filter(Boolean)
        .map((part) => unmark(String(part).replace(/\s+/g, ' ').trim()))
        .join(', ');
      const body = unmark(cleanText(passage.text).trim());
      return `[${passage.marker}] ${from}\n${body}`;
    })
    .join('\n\n---\n\n');
}

export const LOCK_INSTRUCTION =
  'Cite with the markers shown above and no others. A sentence drawn from a passage ends with that passage\'s marker before the full stop, for example "… in 2023 [P3]." A marker you were not shown is not a source. Do not write [Chunk N], a bare number in brackets, or a source name in brackets. The notes from earlier stages may mention material you were not shown; state only what the shown passages support.';

/** Code and links blanked out, so a marker-shaped piece of code is never read as a citation. */
function proseOf(text: string): string {
  let out = '';
  let cursor = 0;
  mapProse(text, (prose) => {
    const at = text.indexOf(prose, cursor);
    out += ' '.repeat(Math.max(0, at - cursor)) + prose;
    cursor = at + prose.length;
    return prose;
  });
  return out;
}

export function markersIn(text: string): string[] {
  const found: string[] = [];
  for (const group of proseOf(text).matchAll(MARKER_GROUP)) {
    found.push(...markersOf(group[1]));
  }
  return found;
}

/** Every word and number of a sentence, lower-cased, in order. Punctuation and spacing do not count. */
function statementKey(text: string): string {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
}

/** A sentence as a reader sees it: a link shows its label, not its destination. */
function readable(text: string): string {
  return (
    text
      .replace(/\[([^\]\n]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1')
      // A reference-style link shows its label; the identifier after it is never
      // seen. Two citation numbers side by side ("[1][2]") are not a link.
      .replace(/\[(?!\s*\d+\s*\])([^\]\n]*)\]\[(?!\s*\d+\s*\])[^\]\n]*\]/g, '$1')
  );
}

/** The text cut into sentences and the gaps between them, each with where it starts. */
function sentencePieces(text: string): Array<{ start: number; text: string }> {
  const out: Array<{ start: number; text: string }> = [];
  let start = 0;
  for (const piece of text.split(SENTENCE_BREAK)) {
    out.push({ start, text: piece });
    start += piece.length;
  }
  return out;
}

/**
 * Where one statement ends and the next begins. A line break inside a paragraph
 * is only a wrap, and a full stop after an initial or a common abbreviation
 * ("U.S.", "Dr.") does not end a sentence; splitting there would tie a citation
 * to half its claim and let the other half be rewritten unnoticed. Erring the
 * other way only makes a statement longer, which is the safe direction.
 */
const SENTENCE_BREAK = new RegExp(
  '(' +
    [
      // A blank line: a new paragraph.
      String.raw`\n[ \t]*\n+`,
      // The line after a heading, and the start of a heading or list item.
      String.raw`(?<=^[ \t]*#{1,6}[ \t][^\n]*)\n`,
      String.raw`\n(?=[ \t]*(?:[-*+]|\d+[.)]|#{1,6})[ \t])`,
      // Sentence punctuation followed by space, except after an initial or abbreviation.
      String.raw`(?<=[.!?])(?<!\b[A-Z]\.)(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc|Inc|Ltd|Co|No|Fig|approx|e\.g|i\.e)\.)\s+`,
    ].join('|') +
    ')',
  'm'
);

/** The prose citations inside one piece, read from the position-preserving prose view. */
function proseMarkersAt(view: string, piece: { start: number; text: string }): string[] {
  const found: string[] = [];
  for (const group of view.slice(piece.start, piece.start + piece.text.length).matchAll(MARKER_GROUP)) {
    found.push(...markersOf(group[1]));
  }
  return found;
}

/**
 * Each citation with the sentence it follows. A marker standing alone belongs to
 * the sentence before it. Sentences are cut from the whole text, so a link or a
 * code span inside a sentence does not split it, and a link's label counts as
 * part of what the sentence says.
 */
function citedSentences(text: string): Array<{ marker: string; statement: string }> {
  const out: Array<{ marker: string; statement: string }> = [];
  const view = proseOf(text);
  let previous = '';
  for (const piece of sentencePieces(text)) {
    if (/^\s*$/.test(piece.text)) continue;
    const prose = readable(piece.text).replace(MARKER_GROUP, ' ').trim();
    const basis = prose.length > 0 ? prose : previous;
    if (prose.length > 0) previous = prose;
    for (const marker of proseMarkersAt(view, piece)) out.push({ marker, statement: statementKey(basis) });
  }
  return out;
}

/**
 * A citation stands only on the sentence it was written for, word for word.
 * Any measure of similarity lets a rewrite change the claim and keep the
 * citation: "is safe" and "is not safe" share nearly every word.
 */
function sameStatement(original: string, rewritten: string): boolean {
  return original === rewritten;
}

/**
 * Which citations in a rewrite still stand on the sentence the writer cited
 * them for. A rewrite is shown the report text and not the passages, so a marker
 * that turns up on a different statement has nothing behind it.
 */
function matchCitations(original: string, rewritten: string): { unsupported: number; unused: number; orphaned: number } {
  const pool = citedSentences(original).map((entry) => ({ ...entry, used: false }));
  let unsupported = 0;
  for (const entry of citedSentences(rewritten)) {
    const match = pool.find((candidate) => !candidate.used && candidate.marker === entry.marker && sameStatement(candidate.statement, entry.statement));
    if (match) match.used = true;
    else unsupported += 1;
  }
  // A citation may go only with its sentence. One whose sentence is still in the
  // rewrite, word for word, has been stripped from a claim that remains.
  const kept = new Set(
    sentencePieces(rewritten)
      .filter((piece) => !/^\s*$/.test(piece.text))
      .map((piece) => statementKey(readable(piece.text).replace(MARKER_GROUP, ' ')))
  );
  const unusedEntries = pool.filter((candidate) => !candidate.used);
  return {
    unsupported,
    unused: unusedEntries.length,
    orphaned: unusedEntries.filter((candidate) => candidate.statement.length > 0 && kept.has(candidate.statement)).length,
  };
}

/**
 * Whether a rewrite kept a section's citations on the statements they were
 * written for. With `allowRemoval`, dropping a citation along with its sentence
 * is accepted; adding one, moving one to another statement, or dropping one
 * while keeping its sentence never is.
 */
export function markersPreserved(original: string, rewritten: string, options: { allowRemoval: boolean }): boolean {
  const { unsupported, unused, orphaned } = matchCitations(original, rewritten);
  if (unsupported > 0) return false;
  return options.allowRemoval ? orphaned === 0 : unused === 0;
}

/** Keep each rewritten section only where it kept that section's citations. */
export function keepRewritesThatPreserveMarkers<T extends { content: string }>(
  original: T[],
  rewritten: T[],
  options: { allowRemoval: boolean }
): T[] {
  return rewritten.map((section, index) => {
    const before = original[index];
    return before && !markersPreserved(before.content, section.content, options) ? before : section;
  });
}

/** Told to a repair of a report written with the citation lock. */
export const LOCKED_REPAIR_RULE =
  'You have not been shown the sources, so you may only cut. Remove the sentences the requirements object to; ' +
  'keep every other sentence exactly as written, with its citation marker such as [P3] attached. ' +
  'Do not remove a citation from a sentence you keep. Do not reword, and do not add a sentence, a citation, a source, a link, a heading or a section. ' +
  'Return every section you were shown, including those you did not change.';

/**
 * A repair of a report written with the citation lock, held to what a repair
 * may do. The repair is shown the report and not the passages, so the one thing
 * it can safely do is cut. A repair once returned a correct, cited report as
 * five bare sentences, and a second added a section citing a source the run had
 * not read; the report was saved with no citations and no references.
 *
 * The result is the report's own sections in their own order under its own
 * title. A section is taken from the repair only when its citations are still
 * on their statements and the repair has only cut from it; otherwise it is put
 * back as it was. A section the repair left out stays, and a section the
 * report did not have is not added. A repair that leaves nothing usable returns
 * the report as it was.
 */
export function guardLockedRepair(
  before: string,
  after: string
): { markdown: string; restored: string[]; dropped: string[] } {
  const key = (heading: string): string => heading.toLowerCase().replace(/\s+/g, ' ').trim();
  const body = (text: string): string => text.split('\n').slice(1).join('\n');
  /**
   * A section's sentences, heading lines and list items in order, exactly as
   * written, each with how it is set off from the one before it: on the same
   * line (0), on a new line (1), or after a blank line (2). Only spaces left at
   * the end of a line are not content. A line break is: it is what makes a
   * list a list and a table a table.
   */
  const pieces = (text: string): Array<{ text: string; gap: number }> => {
    const out: Array<{ text: string; gap: number }> = [];
    let gap = 2;
    // A fenced block is one piece: kept whole or cut whole. Taking off only its
    // fences would turn what it quotes into headings and lists of the report.
    // A fence is three or more of one mark and closes on a run at least as long.
    const fenced = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]{0,3}\1[`~]*[ \t]*$/gm;
    const parts: Array<{ text: string; block: boolean }> = [];
    let cursor = 0;
    const whole = body(text);
    for (const match of whole.matchAll(fenced)) {
      const start = match.index ?? 0;
      parts.push({ text: whole.slice(cursor, start), block: false }, { text: match[0], block: true });
      cursor = start + match[0].length;
    }
    parts.push({ text: whole.slice(cursor), block: false });
    const stream = parts.flatMap((part) => (part.block ? [{ start: 0, text: `\n\n${part.text}\n` }] : sentencePieces(part.text)));
    for (const piece of stream) {
      if (/^\s*$/.test(piece.text)) {
        const breaks = (piece.text.match(/\n/g) ?? []).length;
        gap = Math.max(gap, Math.min(2, breaks));
        continue;
      }
      // A piece can open with the break that set it off.
      const lead = /^\s*\n/.exec(piece.text)?.[0] ?? '';
      const breaks = (lead.match(/\n/g) ?? []).length;
      const indent = /[ \t]*$/.exec(lead)?.[0] ?? '';
      out.push({ text: `${indent}${piece.text.slice(lead.length)}`.replace(/[ \t]+(?=\n|$)/g, ''), gap: Math.max(gap, Math.min(2, breaks)) });
      gap = /\n[ \t]*$/.test(piece.text) ? 1 : 0;
    }
    return out;
  };
  /**
   * A locked repair may cut, and nothing else. It was shown the report and not
   * the passages, so anything it adds or changes was written from no source.
   * What a section holds after the repair must be what it held before, in the
   * same order, less whatever was cut: every piece left is a piece the section
   * had, character for character, citation and all, and set off from its
   * neighbour as it was, or as the cut between them leaves it. A changed sign,
   * a moved citation, a new link, a swapped pair of headings, a reordered pair
   * of sentences, a list run together into a line and a table flattened all
   * fail the same test. A section that had text still has some.
   */
  const onlyCuts = (was: string, now: string): boolean => {
    const had = pieces(was);
    const has = pieces(now);
    // A section that had something to say still says something: a heading
    // with nothing under it is not content.
    const substance = (entries: Array<{ text: string }>): number =>
      entries.filter((entry) => /[\p{L}\p{N}]/u.test(entry.text.replace(new RegExp(MARKER_GROUP.source, 'gi'), '')) && !/^[ \t]{0,3}#{1,6}(?:[ \t]|$)/.test(entry.text) && !/\n[ \t]{0,3}(?:=+|-+)[ \t]*$/.test(entry.text)).length;
    if (substance(had) > 0 && substance(has) === 0) return false;
    // Cuts are taken only from plain writing: sentences, simple bullets and
    // "#" sub-headings, with citation markers. Anything else Markdown can do
    // (links, code, emphasis, tables, quotations, HTML, underlined headings,
    // hard line breaks, indented blocks) comes in parts that only mean something
    // together, and there is no end to the ways a cut can leave one part
    // hanging. A section that holds any of it is taken unchanged or not at all.
    // A section that was cited stays cited: with every citation cut, the
    // report would be saved with nothing behind what is left.
    const cited = (text: string): boolean => new RegExp(MARKER_GROUP.source, 'i').test(text);
    if (cited(was) && !cited(now)) return false;
    // A bullet set in under another takes its meaning from the one above it.
    // A numbered item takes its number from the ones before it, however the
    // number is typed: with an earlier item cut, a ranking reads differently.
    // So does any line set in from the margin (a heading or a sentence inside
    // a list item): cut the line above and it belongs to something else.
    if (/^[ \t]+\S|^\d+[.)][ \t]/m.test(body(was))) return body(was).replace(/\s+$/, '') === body(now).replace(/\s+$/, '');
    // Two sub-headings of one name cannot be told apart once one is cut, so
    // what was under the second would pass as being under the first.
    const subHeadings = (body(was).match(/^[ \t]{0,3}#{1,6}[ \t]+.*$/gm) ?? []).map((line) => line.replace(/^[ \t#]+|[ \t#]+$/g, '').toLowerCase());
    if (new Set(subHeadings).size !== subHeadings.length) return body(was).replace(/\s+$/, '') === body(now).replace(/\s+$/, '');
    // Two spaces at the end of a line are a line break in Markdown. A repair
    // that adds them has changed how the section is set out, not cut from it.
    if (/[ \t]{2,}\n(?=[ \t]*\S)/.test(body(now)) && body(was).replace(/\s+$/, '') !== body(now).replace(/\s+$/, '')) return false;
    const plainOnly = body(was).replace(new RegExp(MARKER_GROUP.source, 'gi'), '');
    const runsOn = /^[ \t]*(?:[-*+][ \t]|\d+[.)][ \t])[^\n]*\n[ \t]*(?![-*+][ \t]|\d+[.)][ \t]|#)\S/m.test(body(was));
    const marked = /[`*_~<>[\]|\\]|:\/\/|\bwww\.|\S@\S|\S[ \t]+[-+][ \t]|^[ \t]*(?:=+|-{2,})[ \t]*$|[ \t]{2,}$|^(?: {4}|\t)|^[ \t]*\+[ \t]/m.test(plainOnly.replace(/^[ \t]*[-*][ \t]/gm, ''));
    if (marked || runsOn) {
      return had.length === has.length && had.every((piece, index) => piece.text === has[index].text && piece.gap === has[index].gap) && body(was).replace(/\s+$/, '') === body(now).replace(/\s+$/, '');
    }
    // A line that Markdown gives a shape (a list item, a table row, a quoted or
    // indented line) is kept whole or cut whole: taking the bullet off a
    // sentence, or a row out of its cell marks, changes what the reader is told
    // it is. Such lines must be the section's own, in order.
    const shaped = (line: string): boolean => /^[ \t]*(?:[-*+][ \t]|\d+[.)][ \t]|>|\|)|^(?: {4}|\t)/.test(line);
    const shapedLines = (text: string): string[] => body(text).split('\n').filter(shaped).map((line) => line.replace(/[ \t]+$/, ''));
    const wasShaped = shapedLines(was);
    let shapedAt = 0;
    for (const line of shapedLines(now)) {
      while (shapedAt < wasShaped.length && wasShaped[shapedAt] !== line) shapedAt += 1;
      if (shapedAt === wasShaped.length) return false;
      shapedAt += 1;
    }
    // And a plain line left standing must not have been part of a shaped one.
    const plainText = (text: string): string => body(text).split('\n').filter((line) => !shaped(line)).join('\n');
    const plainHad = new Set(sentencePieces(plainText(was)).map((piece) => piece.text.trim()).filter(Boolean));
    if (!sentencePieces(plainText(now)).every((piece) => !piece.text.trim() || plainHad.has(piece.text.trim()))) return false;
    // A code fence is cut with its partner or not at all: one left open turns
    // everything after it, the reference list included, into code.
    const fences = (text: string): number => (body(text).match(/^[ \t]{0,3}(?:```|~~~)/gm) ?? []).length;
    if (fences(now) % 2 !== fences(was) % 2) return false;
    // Each piece stays under the sub-heading it was written under: a heading
    // may go only with everything beneath it.
    const isHeading = (text: string): boolean => /^[ \t]{0,3}#{1,6}(?:[ \t]|$)/.test(text);
    const under = (entries: Array<{ text: string }>): string[] => {
      // The whole line of headings above it, by level: a parent cannot go while its child stays.
      const stack: Array<{ level: number; text: string }> = [];
      return entries.map((entry) => {
        if (isHeading(entry.text)) {
          const level = (/#+/.exec(entry.text)?.[0] ?? '#').length;
          while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
          stack.push({ level, text: entry.text });
        }
        return stack.map((heading) => heading.text).join('\n');
      });
    };
    const hadUnder = under(had);
    const hasUnder = under(has);
    let at = 0;
    for (const [index, piece] of has.entries()) {
      const from = at;
      while (at < had.length && (had[at].text !== piece.text || hadUnder[at] !== hasUnder[index])) at += 1;
      if (at === had.length) return false;
      // Words that sat in the middle of a line are not a heading because a cut brought them to the start of one.
      if (isHeading(piece.text) && had[at].gap === 0) return false;
      // Between its own break and the strongest break among whatever was cut before it.
      const strongest = Math.max(...had.slice(from, at + 1).map((entry) => entry.gap));
      if (piece.gap < had[at].gap || piece.gap > strongest) return false;
      at += 1;
    }
    return true;
  };
  // A report that holds a code fence anywhere is not taken apart: a fence can
  // hold lines that look like headings, and one fence can sit inside another.
  // Such a report is kept as it was unless the repair returned it unchanged.
  // The same for a line that opens raw HTML: a "<pre>" block can hold a line
  // that looks like a heading, and taking the report apart there would change
  // what is inside it.
  if (/^[ \t]{0,3}(?:`{3,}|~{3,}|<[A-Za-z!?/])/m.test(before)) return { markdown: before, restored: before === after ? [] : ['(whole report)'], dropped: [] };
  const beforeBlocks = splitTopLevelSections(before);
  const afterBlocks = splitTopLevelSections(after);
  if (beforeBlocks.length === 0) return { markdown: before, restored: [], dropped: afterBlocks.map((block) => block.heading) };
  const repaired = new Map<string, string>();
  const dropped: string[] = [];
  const names = new Set(beforeBlocks.map((block) => key(block.heading)));
  for (const block of afterBlocks) {
    const name = key(block.heading);
    // A section the report did not have, or a second copy of one it has.
    if (!names.has(name) || repaired.has(name)) dropped.push(block.heading);
    else repaired.set(name, block.text);
  }
  // Built in the report's own order from the report's own sections, so a repair
  // can neither leave a section out nor rename one away.
  const restored: string[] = [];
  const kept = beforeBlocks.map((block) => {
    // Two sections of one name cannot be told apart in what the repair returned, so neither is taken from it.
    const twice = beforeBlocks.filter((other) => key(other.heading) === key(block.heading)).length > 1;
    const now = twice ? undefined : repaired.get(key(block.heading));
    // Citations stay on the statements they were written for, and the repair
    // has only cut.
    const sound = now !== undefined && markersPreserved(block.text, now, { allowRemoval: true }) && onlyCuts(block.text, now);
    // The heading line is the report's own: sections are matched by heading
    // with decoration ignored, so the repair's spelling of it is not taken.
    if (sound) return `${block.text.split('\n')[0]}\n${body(now as string)}`.trimEnd();
    restored.push(block.heading);
    return block.text;
  });
  // The title and anything before the first section are the report's own; a
  // repair's preamble was written from no passage.
  const lead = before.split('\n').slice(0, beforeBlocks[0]?.startLine ?? 0).join('\n').trim();
  const markdown = `${lead ? `${lead}\n\n` : ''}${kept.join('\n\n')}\n`;
  if (restored.length === beforeBlocks.length) return { markdown: before, restored, dropped };
  return { markdown, restored, dropped };
}

/**
 * After a repair that rewrote the report without seeing the passages: keep the
 * repaired text, and remove any citation that is not on a statement the writer
 * cited it for. The sentence stays; the unsupported citation does not.
 */
export function stripUnsupportedMarkers(originalMarkdown: string, repairedMarkdown: string): { markdown: string; removed: number } {
  // A marker written as a link is read as the marker, so removing it leaves no "(url)" behind.
  const repaired = unwrapCitationLinks(repairedMarkdown);
  const pool = citedSentences(originalMarkdown).map((entry) => ({ ...entry, used: false }));
  const view = proseOf(repaired);
  let removed = 0;
  let previous = '';
  const out = sentencePieces(repaired)
    .map((piece) => {
      if (/^\s*$/.test(piece.text)) return piece.text;
      const prose = readable(piece.text).replace(MARKER_GROUP, ' ').trim();
      const basis = statementKey(prose.length > 0 ? prose : previous);
      if (prose.length > 0) previous = prose;
      return piece.text.replace(MARKER_GROUP, (full: string, inner: string, offset: number) => {
        // A marker-shaped piece of code is not a citation and is left as written.
        const at = piece.start + offset;
        if (view.slice(at, at + full.length) !== full) return full;
        const kept: string[] = [];
        for (const marker of markersOf(inner)) {
          const match = pool.find((candidate) => !candidate.used && candidate.marker === marker && sameStatement(candidate.statement, basis));
          if (match) {
            match.used = true;
            kept.push(marker);
          } else {
            removed += 1;
          }
        }
        return kept.length > 0 ? `[${kept.join(', ')}]` : '\uE002';
      });
    })
    .join('');
  return { markdown: mapProse(out, (prose) => tidyAfterRemoval(prose.replace(/[ \t]*\uE002/g, ''))), removed };
}

/** Apply a change to prose only. Code in every Markdown form, links and URLs are returned untouched. */
const mapProse = mapCitationProse;

/** Reader numbers in the prose of a text, in reading order. Numbers in code and links are not citations. */
export function readerNumbersIn(text: string): string[] {
  const found: string[] = [];
  mapProse(text, (prose) => {
    found.push(...(prose.match(/\[\d+\](?!\()/g) ?? []));
    return prose;
  });
  return found;
}

/** Remove reader numbers from prose. Used where a text is not tied to saved citations. */
export function stripReaderNumbers(text: string): string {
  // A number written as a link is still a number the reader sees.
  return mapProse(unwrapCitationLinks(text), (prose) => tidyAfterRemoval(prose.replace(BARE_NUMBERS, '')));
}

/** Markers in the text that were not among the passages the section was shown. */
export function unknownMarkers(text: string, shown: LockedPassage[]): string[] {
  const allowed = new Set(shown.map((passage) => passage.marker));
  return [...new Set(markersIn(text).filter((marker) => !allowed.has(marker)))];
}

function tidyAfterRemoval(text: string): string {
  // Runs of spaces inside a line are closed up; indentation at the start of a
  // line is structure (a nested list) and is left alone.
  return text.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/(\S)[ \t]{2,}/g, '$1 ');
}

/** Remove markers the section was not shown. The sentence stays; the false citation does not. */
export function stripUnknownMarkers(text: string, shown: LockedPassage[]): string {
  const allowed = new Set(shown.map((passage) => passage.marker));
  // Prose only: a marker-shaped piece of code is not a citation and is never edited.
  // A marker written as a link is read as the marker, so removing it leaves no "(url)" behind.
  return mapProse(unwrapCitationLinks(text), (prose) =>
    tidyAfterRemoval(
      prose
        .replace(MARKER_GROUP, (_full, inner: string) => {
          const kept = markersOf(inner).filter((marker) => allowed.has(marker));
          return kept.length > 0 ? `[${kept.join(', ')}]` : '\uE002';
        })
        .replace(/[ \t]*\uE002/g, '')
    )
  );
}

/** Split into sentences, keeping each one exactly as it appears in the source text. */
function verbatimSentences(text: string): string[] {
  // Break only after sentence punctuation followed by a space, or at a line break,
  // so a decimal point or an abbreviation inside a sentence does not split it.
  return text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

export const QUOTE_MAX_CHARS = 320;
const NEGATION = /\b(?:not|no|never|none|neither|nor|without|cannot)\b|n't\b/i;

/**
 * The part of the passage that the citing sentence most likely rests on, copied
 * word for word. When nothing overlaps, the opening of the passage is used.
 */
export function bestQuote(passageText: string, citingSentence: string): string {
  const wanted = terms(citingSentence);
  const wantedNegated = NEGATION.test(citingSentence);
  let best = '';
  let bestScore = -1;
  for (const sentence of verbatimSentences(passageText)) {
    // A sentence that says the opposite shares nearly every word. One that
    // agrees on whether the claim is negated wins over one that does not.
    const score = overlap(new Set(terms(sentence)), wanted) + (NEGATION.test(sentence) === wantedNegated ? 0.5 : 0);
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  const quote = (best || passageText.trim()).slice(0, QUOTE_MAX_CHARS).trim();
  return quote;
}

function sentenceBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('.\n'), before.lastIndexOf('? '), before.lastIndexOf('! '), before.lastIndexOf('\n'));
  return before.slice(start + 1).trim();
}

// The report's own title (a level-1 heading that opens the report) is never a
// system section, whatever it says. A later level-1 "References" is one.
// A heading may close with hashes of its own ("## References ##").
const SYSTEM_SECTION = /^#{1,6}\s+(?:References|About this report)(?:\s+#+)?\s*$/i;

/**
 * The report without its reference list and closing note. A system section runs
 * until the next heading at its own level or above, so a sub-heading inside a
 * model-written reference list is removed with it.
 */
export function dropSystemSections(markdown: string): string {
  const lines = markdown.split('\n');
  const kept: string[] = [];
  let skippingLevel = 0;
  let seenContent = false;
  let fence: { mark: string; length: number } | null = null;
  for (const line of lines) {
    // A heading inside a code fence is code. Indented code never matches the
    // heading pattern, which allows no leading spaces.
    const fenceLine = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceLine) {
      const mark = fenceLine[1][0];
      const length = fenceLine[1].length;
      if (!fence) fence = { mark, length };
      else if (mark === fence.mark && length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
    } else if (!fence) {
      const heading = /^(#{1,6})\s+/.exec(line);
      if (heading) {
        const level = heading[1].length;
        if (skippingLevel === 0 || level <= skippingLevel) {
          // The title is a level-1 heading with nothing before it. After any
          // prose, code or heading, a "References" heading is a reference list.
          const title = level === 1 && !seenContent;
          skippingLevel = SYSTEM_SECTION.test(line) && !title ? level : 0;
        }
      }
    }
    if (/\S/.test(line)) seenContent = true;
    if (skippingLevel === 0) kept.push(line);
  }
  return kept.join('\n').trimEnd();
}

/** Identity of the stored source behind a passage. Title and link are a fallback for a passage with no stored source. */
function passageSourceKey(passage: LockedPassage): string {
  return passage.sourceId || sourceKey(passage.source) || passage.chunkId;
}

function titleWords(title: string): string[] {
  return title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Runs of five words, for telling whether two texts are the same text. */
function shingles(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + 5 <= words.length; i += 1) out.add(words.slice(i, i + 5).join(' '));
  return out;
}

const SAME_TITLE_MIN_WORDS = 4;
const SAME_TEXT_SHARE = 0.5;

/**
 * Stored sources that are one article published in two places: the title of one
 * is the title of the other with a site name added, and their passages are
 * largely the same words. Both conditions are needed. Two articles can share a
 * title, and two articles can quote the same paragraph; one article carried by
 * two sites does both. Returns, for each source that is a copy, the source it
 * is a copy of (the one retrieved first), so the pair is numbered and listed once.
 */
export function sameArticleSources(passages: LockedPassage[]): Map<string, string> {
  const order: string[] = [];
  const info = new Map<string, { title: string[]; text: Set<string> }>();
  for (const passage of passages) {
    const key = passageSourceKey(passage);
    let entry = info.get(key);
    if (!entry) {
      entry = { title: titleWords(passage.source.title ?? ''), text: new Set<string>() };
      info.set(key, entry);
      order.push(key);
    }
    for (const shingle of shingles(passage.text)) entry.text.add(shingle);
  }
  const contains = (longer: string[], shorter: string[]): boolean => {
    if (shorter.length < SAME_TITLE_MIN_WORDS || shorter.length > longer.length) return false;
    for (let start = 0; start + shorter.length <= longer.length; start += 1) {
      if (shorter.every((word, index) => longer[start + index] === word)) return true;
    }
    return false;
  };
  const copyOf = new Map<string, string>();
  for (let later = 1; later < order.length; later += 1) {
    const b = info.get(order[later]);
    if (!b) continue;
    for (let earlier = 0; earlier < later; earlier += 1) {
      const a = info.get(order[earlier]);
      if (!a) continue;
      if (!contains(a.title, b.title) && !contains(b.title, a.title)) continue;
      const smaller = Math.min(a.text.size, b.text.size);
      if (smaller === 0) continue;
      let shared = 0;
      for (const shingle of a.text.size <= b.text.size ? a.text : b.text) if ((a.text.size <= b.text.size ? b.text : a.text).has(shingle)) shared += 1;
      if (shared / smaller >= SAME_TEXT_SHARE) {
        // A copy of a copy is a copy of the first: A and B match, B and C match,
        // and the passages retrieved from A and C need not overlap at all.
        copyOf.set(order[later], copyOf.get(order[earlier]) ?? order[earlier]);
        break;
      }
    }
  }
  return copyOf;
}

/**
 * A passage label written into a sentence ("while P20 notes that…"). The writer
 * cites with the marker; a label in the prose is the pipeline showing through.
 * Read only in the form the labels are issued in, a capital P, and only before a
 * verb of saying: lower-case "p53" is a protein, not a passage.
 */
const SPOKEN_PASSAGE_LABEL = /\b(?:(?:[Pp]assages?|[Ss]ources?|[Cc]hunks?)\s+)?P(\d+)\b(?=\s+(?:notes?|states?|shows?|reports?|says?|describes?|mentions?|indicates?|suggests?|argues?|finds?|confirms?|provides?|cites?|adds?|also|and\s+P\d+)\b)/g;

export interface FinalizedCitations {
  markdown: string;
  /** One entry per marker left in the text, in reading order. */
  occurrences: CitationOccurrence[];
  cited: UsedSource[];
  /** Markers that named no passage and were removed. */
  removed: number;
}

/**
 * Turn `[P#]` markers into reader numbers and add the reference list and the
 * closing note. One number per source, in order of first citation. A marker that
 * names no passage is removed.
 */
export function finalizeLockedCitations(
  markdown: string,
  passages: LockedPassage[],
  readOn = formatReadDate(),
  style: ReferenceStyle = 'numeric'
): FinalizedCitations {
  const byMarker = new Map(passages.map((passage) => [passage.marker, passage]));
  const copyOf = sameArticleSources(passages);
  const identity = (passage: LockedPassage): string => {
    const key = passageSourceKey(passage);
    return copyOf.get(key) ?? key;
  };
  const numberBySource = new Map<string, number>();
  const cited: UsedSource[] = [];
  const occurrences: CitationOccurrence[] = [];
  let removed = 0;
  // A citation written as a link ("[1](url)", "[Chunk 4](url)") is read as the
  // citation the reader takes it for, so it is bound or removed like any other.
  const withoutSystem = unwrapCitationLinks(dropSystemSections(markdown));
  // The sentence each citation closes, read from the whole text so a link inside
  // the sentence does not cut it short. One entry per marker group, in order.
  const citing: string[] = [];
  {
    const view = proseOf(withoutSystem);
    let previous = '';
    for (const piece of sentencePieces(withoutSystem)) {
      if (/^\s*$/.test(piece.text)) continue;
      const prose = readable(piece.text).replace(MARKER_GROUP, ' ').trim();
      if (prose.length > 0) previous = prose;
      const groups = [...view.slice(piece.start, piece.start + piece.text.length).matchAll(MARKER_GROUP)].length;
      for (let n = 0; n < groups; n += 1) citing.push(prose.length > 0 ? prose : previous);
    }
  }
  let group = 0;
  const text = mapProse(withoutSystem, (prose) => {
    // A bare number in brackets was not issued by the lock. Left in, it would
    // read as a citation with no reference behind it and could be mistaken for
    // one of the numbers assigned below. Code is never touched.
    removed += (prose.match(BARE_NUMBERS) ?? []).length;
    // A locked report has no chunk markers: a later repair that writes
    // "[Chunk 4]" has cited nothing the lock can save.
    removed += (prose.match(CHUNK_MARKER) ?? []).length + (prose.match(EXPORT_ALIAS) ?? []).length;
    const body = tidyAfterRemoval(
      prose
        .replace(BARE_NUMBERS, '')
        .replace(CHUNK_MARKER, '')
        .replace(EXPORT_ALIAS, '')
        // A marker written as link text is a citation; the link around it is dropped.
        .replace(/(\[\s*P\d+[^\]\n]*\])\([^)\s]*(?:\s+"[^"]*")?\)/gi, '$1')
        // Likewise the empty second bracket of a collapsed reference link.
        .replace(/(\[\s*P\d+[^\]\n]*\])\[\]/gi, '$1')
        // And the label of a full reference link ("[P1][source]"); a second marker is kept.
        .replace(/(\[\s*P\d+[^\]\n]*\])\[(?!\s*P?\d+\s*[\],;])[^\]\n]*\]/gi, '$1')
    );
    // Markers standing side by side are one run. Two passages of one source in a
    // run would print the same number twice ("[1][1]"); the number is shown once,
    // with the first passage behind it.
    let runEnd = -1;
    let runNumbers = new Set<number>();
    const rewritten = body.replace(MARKER_GROUP, (full: string, inner: string, offset: number) => {
      const numbers: number[] = [];
      const sentence = citing[group] ?? sentenceBefore(body, offset);
      group += 1;
      if (runEnd === -1 || body.slice(runEnd, offset).trim() !== '') runNumbers = new Set<number>();
      runEnd = offset + full.length;
      for (const marker of markersOf(inner)) {
        const passage = byMarker.get(marker);
        // The stored source is the identity. Title and link are a fallback: two
        // uploads can share a title and have no link, and are still two sources.
        const key = passage ? identity(passage) : '';
        if (!passage || !key) {
          removed += 1;
          continue;
        }
        let number = numberBySource.get(key);
        if (!number) {
          number = cited.length + 1;
          numberBySource.set(key, number);
          cited.push(passage.source);
        }
        if (runNumbers.has(number)) continue;
        runNumbers.add(number);
        occurrences.push({ number, chunkId: passage.chunkId, quote: bestQuote(passage.text, sentence) });
        numbers.push(number);
      }
      return numbers.length > 0 ? numbers.map((number) => `[${number}]`).join('') : '\uE002';
    });
    // Anything still shaped like a passage marker was not a citation the lock could read.
    const leftover = rewritten.match(PASSAGE_LOOKING) ?? [];
    removed += leftover.length;
    const unmarked = rewritten.replace(PASSAGE_LOOKING, '').replace(/[ \t]*\uE002/g, '');
    // A label of a passage that was issued, written into the sentence itself.
    const spoken = unmarked.replace(SPOKEN_PASSAGE_LABEL, (label: string, digits: string, offset: number) => {
      if (!byMarker.has(`P${digits}`)) return label;
      removed += 1;
      const opensSentence = offset === 0 || /[.!?]\s+$|\n\s*$/.test(unmarked.slice(0, offset));
      return opensSentence ? 'One source' : 'one source';
    });
    return tidyAfterRemoval(spoken);
  });
  // Titles and publishers come from the sources themselves. One that contains a
  // marker, a bracketed number or a line break must not put either into the report.
  const plain = (value: string | null | undefined): string | null | undefined =>
    value == null ? value : value.replace(/\s+/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').replace(/^#+\s*/, '').trim();
  const references = buildReferences(
    cited.map((source) => ({
      ...source,
      title: plain(source.title) || 'Untitled source',
      publisher: plain(source.publisher),
      authors: (source.authors ?? []).map((author) => plain(author) ?? '').filter(Boolean),
    })),
    style
  );
  // Counted by the same identity the numbers use, so the note and the list agree.
  const readCount = new Set(
    passages
      .filter((passage) => Boolean(passage.sourceId || sourceKey(passage.source)))
      .map(identity)
  ).size;
  const about = buildAbout(cited.length === 0 ? 0 : readCount, readOn);
  const tail = `${references ? `\n\n## References\n${references}` : ''}\n\n## About this report\n${about}`;
  return { markdown: `${text}${tail}`, occurrences, cited, removed };
}

export interface BoundCitation extends CitationOccurrence {
  /** 1-based position of the section among the saved sections; null when it could not be placed. */
  sectionOrder: number | null;
  /** 1-based position of the citation in the whole report. */
  order: number;
}

/**
 * Tie each citation to the saved section it appears in. Sections are the ones the
 * report is saved as, in order. The reference list and the closing note carry no
 * citations of their own.
 */
export function assignOccurrencesToSections(
  sections: Array<{ title: string; content: string }>,
  occurrences: CitationOccurrence[]
): BoundCitation[] {
  const bound: BoundCitation[] = [];
  let cursor = 0;
  sections.forEach((section, index) => {
    // The generated reference list and closing note come after the report. A
    // report that opens with a section of that name is an ordinary section.
    if (index > 0 && /^(?:references|about this report)$/i.test(section.title.trim())) return;
    // Count what finalizing numbered: prose only. A number inside code, or the
    // label of a link, was never a citation and must not take one's place.
    const markers = readerNumbersIn(`${section.title}\n${section.content}`);
    for (const marker of markers) {
      const occurrence = occurrences[cursor];
      if (!occurrence || `[${occurrence.number}]` !== marker) continue;
      bound.push({ ...occurrence, sectionOrder: index + 1, order: cursor + 1 });
      cursor += 1;
    }
  });
  for (; cursor < occurrences.length; cursor += 1) {
    bound.push({ ...occurrences[cursor], sectionOrder: null, order: cursor + 1 });
  }
  return bound;
}

/** Grant I. On a Layer 1 run the fixed source count is recorded and does not set the status. */
export function countShortfallSetsStatus(layer1Run: boolean): boolean {
  return !layer1Run;
}

const READER_NUMBER = /\[\d+\](?!\()/g;
/** Two or more numbers in one bracket: "[1, 2]", "[1 and 2]", "[1-3]". */
const GROUPED_NUMBERS = /[ \t]*\[\s*\d+(?:\s*(?:[,;/&+\u2013\u2014-]|and|to)\s*\d+)+\s*\](?!\()/g;

/**
 * Carry a locked report's citations into a revision of it.
 *
 * A revision rewrites sections without seeing the passages. A citation is kept
 * only where its sentence is unchanged, word for word; anywhere else the number
 * is removed from the revised text, so no number is left without a row behind it
 * and no row is left on a claim it was not written for. Kept rows come back in
 * the reading order of the revised report.
 *
 * `rows` are the base report's citations in reading order. Sections are matched
 * by `key`, which a revised section keeps from the section it was made from.
 */
export function rebindRevisedCitations<T>(
  base: Array<{ key: string; content: string }>,
  rows: Array<{ sectionKey: string; citationText: string; row: T }>,
  revised: Array<{ key: string; content: string }>,
  /** Whether a row still has its passage behind it. One that does not is not carried, and its number is removed. */
  carriable: (row: T) => boolean = () => true
): { contents: string[]; kept: Array<{ sectionIndex: number; row: T }>; removed: number } {
  const numbered = (content: string): Array<{ number: string; statement: string }> => {
    const out: Array<{ number: string; statement: string }> = [];
    const view = proseOf(content);
    let previous = '';
    for (const piece of sentencePieces(content)) {
      if (/^\s*$/.test(piece.text)) continue;
      const prose = readable(piece.text).replace(READER_NUMBER, ' ').trim();
      const basis = prose.length > 0 ? prose : previous;
      if (prose.length > 0) previous = prose;
      for (const hit of view.slice(piece.start, piece.start + piece.text.length).matchAll(READER_NUMBER)) {
        out.push({ number: hit[0], statement: statementKey(basis) });
      }
    }
    return out;
  };

  const baseByKey = new Map(base.map((section) => [section.key, section]));
  const rowsByKey = new Map<string, Array<{ citationText: string; row: T }>>();
  for (const entry of rows) rowsByKey.set(entry.sectionKey, [...(rowsByKey.get(entry.sectionKey) ?? []), entry]);

  let removed = 0;
  const kept: Array<{ sectionIndex: number; row: T }> = [];
  const contents = revised.map((section, sectionIndex) => {
    const before = baseByKey.get(section.key);
    const sectionRows = rowsByKey.get(section.key) ?? [];
    if (before && before.content === section.content && sectionRows.every((entry) => carriable(entry.row))) {
      for (const entry of sectionRows) kept.push({ sectionIndex, row: entry.row });
      return section.content;
    }
    // Pair the base section's numbers with its rows. If they do not line up, the
    // base gives nothing deterministic to carry, and every number here is removed.
    const baseNumbers = before ? numbered(before.content) : [];
    const paired =
      baseNumbers.length === sectionRows.length && baseNumbers.every((entry, k) => entry.number === sectionRows[k].citationText.trim());
    const pool = paired ? baseNumbers.map((entry, k) => ({ ...entry, row: sectionRows[k].row, used: false })) : [];

    // A rewrite may merge numbers into one bracket ("[1, 2]"). Such a bracket is
    // on a rewritten sentence by definition, so it carries nothing and is removed.
    // A number written as a link ("[1](url)") or with spaces ("[ 1 ]") is still
    // a number the reader sees; read it as one, so it is carried or removed.
    // A rewriter that never saw the passages can also write a passage marker, a
    // chunk marker or an export alias. None has a saved row; all are removed.
    const content = mapProse(unwrapCitationLinks(section.content), (prose) => {
      for (const form of [GROUPED_NUMBERS, PASSAGE_LOOKING, CHUNK_MARKER, EXPORT_ALIAS]) {
        removed += (prose.match(form) ?? []).length;
        prose = prose.replace(form, '\uE002');
      }
      return prose.replace(/\[\s*(\d+)\s*\](?!\()/g, '[$1]');
    });
    const view = proseOf(content);
    let previous = '';
    const rewritten = sentencePieces(content)
      .map((piece) => {
        if (/^\s*$/.test(piece.text)) return piece.text;
        const prose = readable(piece.text).replace(READER_NUMBER, ' ').trim();
        const basis = statementKey(prose.length > 0 ? prose : previous);
        if (prose.length > 0) previous = prose;
        return piece.text.replace(READER_NUMBER, (full: string, offset: number) => {
          const at = piece.start + offset;
          if (view.slice(at, at + full.length) !== full) return full;
          const match = pool.find((candidate) => !candidate.used && candidate.number === full && sameStatement(candidate.statement, basis));
          if (match) match.used = true;
          if (!match || !carriable(match.row)) {
            removed += 1;
            return '\uE002';
          }
          kept.push({ sectionIndex, row: match.row });
          return full;
        });
      })
      .join('');
    return mapProse(rewritten, (prose) => tidyAfterRemoval(prose.replace(/[ \t]*\uE002/g, '')));
  });
  return { contents, kept, removed };
}

/**
 * After a revision has dropped citations: number the sources again in the order
 * they are now first cited, and cut the reference list down to the ones still
 * cited. The entries themselves are kept as written; only their numbers change.
 * `citationTexts` are the kept rows' numbers, returned renumbered in the same order.
 */
export function renumberAfterRevision(
  sections: Array<{ title: string; content: string }>,
  citationTexts: string[]
): { titles: string[]; contents: string[]; citationTexts: string[] } {
  // The generated reference list and closing note come after the report. A
  // report that opens with a section of that name is an ordinary section.
  const isSystem = (title: string, index: number): boolean => index > 0 && /^(?:references|about this report)$/i.test(title.trim());
  const order: string[] = [];
  for (const [index, section] of sections.entries()) {
    if (isSystem(section.title, index)) continue;
    // A heading can carry a citation too, and it is read before its body.
    for (const number of readerNumbersIn(`${section.title}\n${section.content}`)) if (!order.includes(number)) order.push(number);
  }
  const renumbered = new Map(order.map((old, index) => [old, `[${index + 1}]`]));
  const contents = sections.map((section, index) => {
    if (index > 0 && /^references$/i.test(section.title.trim())) {
      const lines = new Map<string, string>();
      for (const line of section.content.split('\n')) {
        const entry = /^\s*(\d+)\.\s+(.*)$/.exec(line);
        if (entry) lines.set(`[${entry[1]}]`, entry[2]);
      }
      // A list that is not in the expected numbered form is left as it is.
      if (lines.size === 0) return section.content;
      return order
        .filter((old) => lines.has(old))
        .map((old) => `${(renumbered.get(old) as string).slice(1, -1)}. ${lines.get(old)}`)
        .join('\n');
    }
    // The closing note says how many sources were read, which a revision does not
    // change. The one case it must follow is a report left citing nothing, where
    // the first save would have said so.
    if (isSystem(section.title, index)) return order.length === 0 ? buildAbout(0, '') : section.content;
    return mapProse(section.content, (prose) => prose.replace(READER_NUMBER, (full) => renumbered.get(full) ?? full));
  });
  const titles = sections.map((section, index) =>
    isSystem(section.title, index) ? section.title : mapProse(section.title, (prose) => prose.replace(READER_NUMBER, (full) => renumbered.get(full) ?? full))
  );
  return { titles, contents, citationTexts: citationTexts.map((text) => renumbered.get(text.trim()) ?? text) };
}
