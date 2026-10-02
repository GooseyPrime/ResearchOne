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
import { mapCitationProse } from '../formatting/reportPresentation';
import { buildAbout, buildReferences, formatReadDate, sourceKey, type UsedSource } from './baselineReport';

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
const PASSAGE_LOOKING = /[ \t]*\[\s*P\d+\b[^\]\n]*\]/gi;
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
      const from = [passage.source.publisher, passage.source.title].filter(Boolean).join(', ');
      return `[${passage.marker}] ${from}\n${cleanText(passage.text).trim()}`;
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
  return text.replace(/\[([^\]\n]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1');
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

/**
 * After a repair that rewrote the report without seeing the passages: keep the
 * repaired text, and remove any citation that is not on a statement the writer
 * cited it for. The sentence stays; the unsupported citation does not.
 */
export function stripUnsupportedMarkers(originalMarkdown: string, repairedMarkdown: string): { markdown: string; removed: number } {
  const pool = citedSentences(originalMarkdown).map((entry) => ({ ...entry, used: false }));
  const view = proseOf(repairedMarkdown);
  let removed = 0;
  let previous = '';
  const out = sentencePieces(repairedMarkdown)
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
  return mapProse(text, (prose) => tidyAfterRemoval(prose.replace(BARE_NUMBERS, '')));
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
  return mapProse(text, (prose) =>
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

// Level 1 is the report's own title and is never a system section, whatever it says.
const SYSTEM_SECTION = /^#{2,3}\s+(?:References|About this report)\s*$/i;

/**
 * The report without its reference list and closing note. A system section runs
 * until the next heading at its own level or above, so a sub-heading inside a
 * model-written reference list is removed with it.
 */
export function dropSystemSections(markdown: string): string {
  const lines = markdown.split('\n');
  const kept: string[] = [];
  let skippingLevel = 0;
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
          skippingLevel = SYSTEM_SECTION.test(line) ? level : 0;
        }
      }
    }
    if (skippingLevel === 0) kept.push(line);
  }
  return kept.join('\n').trimEnd();
}

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
export function finalizeLockedCitations(markdown: string, passages: LockedPassage[], readOn = formatReadDate()): FinalizedCitations {
  const byMarker = new Map(passages.map((passage) => [passage.marker, passage]));
  const numberBySource = new Map<string, number>();
  const cited: UsedSource[] = [];
  const occurrences: CitationOccurrence[] = [];
  let removed = 0;
  const withoutSystem = dropSystemSections(markdown);
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
    const rewritten = body.replace(MARKER_GROUP, (_full, inner: string, offset: number) => {
      const numbers: number[] = [];
      const sentence = citing[group] ?? sentenceBefore(body, offset);
      group += 1;
      for (const marker of markersOf(inner)) {
        const passage = byMarker.get(marker);
        // The stored source is the identity. Title and link are a fallback: two
        // uploads can share a title and have no link, and are still two sources.
        const key = passage ? passage.sourceId || sourceKey(passage.source) || passage.chunkId : '';
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
        occurrences.push({ number, chunkId: passage.chunkId, quote: bestQuote(passage.text, sentence) });
        numbers.push(number);
      }
      return numbers.length > 0 ? numbers.map((number) => `[${number}]`).join('') : '\uE002';
    });
    // Anything still shaped like a passage marker was not a citation the lock could read.
    const leftover = rewritten.match(PASSAGE_LOOKING) ?? [];
    removed += leftover.length;
    return tidyAfterRemoval(rewritten.replace(PASSAGE_LOOKING, '').replace(/[ \t]*\uE002/g, ''));
  });
  // Titles and publishers come from the sources themselves. One that contains a
  // marker, a bracketed number or a line break must not put either into the report.
  const plain = (value: string | null | undefined): string | null | undefined =>
    value == null ? value : value.replace(/\s+/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').replace(/^#+\s*/, '').trim();
  const references = buildReferences(cited.map((source) => ({ ...source, title: plain(source.title) || 'Untitled source', publisher: plain(source.publisher) })));
  // Counted by the same identity the numbers use, so the note and the list agree.
  const readCount = new Set(passages.map((passage) => passage.sourceId || sourceKey(passage.source)).filter(Boolean)).size;
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
    if (/^(?:references|about this report)$/i.test(section.title.trim())) return;
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
  revised: Array<{ key: string; content: string }>
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
    if (before && before.content === section.content) {
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
    const content = mapProse(section.content, (prose) => {
      removed += (prose.match(GROUPED_NUMBERS) ?? []).length;
      return prose.replace(GROUPED_NUMBERS, '\uE002');
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
          if (!match) {
            removed += 1;
            return '\uE002';
          }
          match.used = true;
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
  const isSystem = (title: string): boolean => /^(?:references|about this report)$/i.test(title.trim());
  const order: string[] = [];
  for (const section of sections) {
    if (isSystem(section.title)) continue;
    // A heading can carry a citation too, and it is read before its body.
    for (const number of readerNumbersIn(`${section.title}\n${section.content}`)) if (!order.includes(number)) order.push(number);
  }
  const renumbered = new Map(order.map((old, index) => [old, `[${index + 1}]`]));
  const contents = sections.map((section) => {
    if (/^references$/i.test(section.title.trim())) {
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
    if (isSystem(section.title)) return section.content;
    return mapProse(section.content, (prose) => prose.replace(READER_NUMBER, (full) => renumbered.get(full) ?? full));
  });
  const titles = sections.map((section) =>
    isSystem(section.title) ? section.title : mapProse(section.title, (prose) => prose.replace(READER_NUMBER, (full) => renumbered.get(full) ?? full))
  );
  return { titles, contents, citationTexts: citationTexts.map((text) => renumbered.get(text.trim()) ?? text) };
}
