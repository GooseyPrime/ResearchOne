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
import { buildAbout, buildReferences, distinctSourceCount, formatReadDate, sourceKey, type UsedSource } from './baselineReport';

export interface LockedPassage {
  /** `P1`, `P2`, … in the order the passages were retrieved. */
  marker: string;
  chunkId: string;
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

const MARKER_GROUP = /\[\s*(P\d+(?:\s*[,;]\s*P\d+)*)\s*\]/g;
const SINGLE_MARKER = /P\d+/g;

export function issuePassages(chunks: Array<{ id: string; content: string }>, sources: UsedSource[]): LockedPassage[] {
  return chunks.map((chunk, index) => ({
    marker: `P${index + 1}`,
    chunkId: chunk.id,
    text: chunk.content,
    source: sources[index] ?? { title: 'Untitled source' },
  }));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'its',
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
  return passages
    .map((passage) => {
      const from = [passage.source.publisher, passage.source.title].filter(Boolean).join(', ');
      return `[${passage.marker}] ${from}\n${cleanText(passage.text).trim()}`;
    })
    .join('\n\n---\n\n');
}

export const LOCK_INSTRUCTION =
  'Cite with the markers shown above and no others. A sentence drawn from a passage ends with that passage\'s marker before the full stop, for example "… in 2023 [P3]." A marker you were not shown is not a source. Do not write [Chunk N], a bare number in brackets, or a source name in brackets. The notes from earlier stages may mention material you were not shown; state only what the shown passages support.';

export function markersIn(text: string): string[] {
  const found: string[] = [];
  for (const group of text.matchAll(MARKER_GROUP)) {
    for (const marker of group[1].match(SINGLE_MARKER) ?? []) found.push(marker);
  }
  return found;
}

/** Each citation with the terms of the sentence it follows. A marker standing alone belongs to the sentence before it. */
function citedSentences(text: string): Array<{ marker: string; terms: Set<string> }> {
  const out: Array<{ marker: string; terms: Set<string> }> = [];
  let previous = '';
  for (const sentence of verbatimSentences(text)) {
    const markers = markersIn(sentence);
    const prose = sentence.replace(MARKER_GROUP, ' ').trim();
    const basis = prose.length > 0 ? prose : previous;
    if (prose.length > 0) previous = prose;
    for (const marker of markers) out.push({ marker, terms: new Set(terms(basis)) });
  }
  return out;
}

/** Share of the original sentence's terms that the rewritten sentence still carries. */
function sameStatement(original: Set<string>, rewritten: Set<string>): boolean {
  if (original.size === 0) return rewritten.size === 0;
  let kept = 0;
  for (const term of original) if (rewritten.has(term)) kept += 1;
  return kept / original.size >= 0.6;
}

/**
 * Which citations in a rewrite still stand on the sentence the writer cited
 * them for. A rewrite is shown the report text and not the passages, so a marker
 * that turns up on a different statement has nothing behind it.
 */
function matchCitations(original: string, rewritten: string): { unsupported: number; unused: number } {
  const pool = citedSentences(original).map((entry) => ({ ...entry, used: false }));
  let unsupported = 0;
  for (const entry of citedSentences(rewritten)) {
    const match = pool.find((candidate) => !candidate.used && candidate.marker === entry.marker && sameStatement(candidate.terms, entry.terms));
    if (match) match.used = true;
    else unsupported += 1;
  }
  return { unsupported, unused: pool.filter((candidate) => !candidate.used).length };
}

/**
 * Whether a rewrite kept a section's citations on the statements they were
 * written for. With `allowRemoval`, dropping a citation along with its sentence
 * is accepted; adding one or moving one to another statement never is.
 */
export function markersPreserved(original: string, rewritten: string, options: { allowRemoval: boolean }): boolean {
  const { unsupported, unused } = matchCitations(original, rewritten);
  if (unsupported > 0) return false;
  return options.allowRemoval || unused === 0;
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
  let removed = 0;
  let previous = '';
  const pieces = repairedMarkdown.split(/((?<=[.!?])\s+|\n+)/);
  const out = pieces.map((piece) => {
    if (/^\s*$/.test(piece)) return piece;
    const prose = piece.replace(MARKER_GROUP, ' ').trim();
    const basis = new Set(terms(prose.length > 0 ? prose : previous));
    if (prose.length > 0) previous = prose;
    return piece.replace(MARKER_GROUP, (_full, inner: string) => {
      const kept: string[] = [];
      for (const marker of inner.match(SINGLE_MARKER) ?? []) {
        const match = pool.find((candidate) => !candidate.used && candidate.marker === marker && sameStatement(candidate.terms, basis));
        if (match) {
          match.used = true;
          kept.push(marker);
        } else {
          removed += 1;
        }
      }
      return kept.length > 0 ? `[${kept.join(', ')}]` : '\uE002';
    });
  });
  return { markdown: tidyAfterRemoval(out.join('').replace(/[ \t]*\uE002/g, '')), removed };
}

/** Apply a change to prose only. Fenced and inline code is returned untouched. */
function mapProse(text: string, change: (prose: string) => string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : change(part)))
    .join('');
}

/** Remove reader numbers from prose. Used where a text is not tied to saved citations. */
export function stripReaderNumbers(text: string): string {
  return mapProse(text, (prose) => tidyAfterRemoval(prose.replace(/[ \t]*\[\d+\](?!\()/g, '')));
}

/** Markers in the text that were not among the passages the section was shown. */
export function unknownMarkers(text: string, shown: LockedPassage[]): string[] {
  const allowed = new Set(shown.map((passage) => passage.marker));
  return [...new Set(markersIn(text).filter((marker) => !allowed.has(marker)))];
}

function tidyAfterRemoval(text: string): string {
  return text.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ');
}

/** Remove markers the section was not shown. The sentence stays; the false citation does not. */
export function stripUnknownMarkers(text: string, shown: LockedPassage[]): string {
  const allowed = new Set(shown.map((passage) => passage.marker));
  const stripped = text.replace(MARKER_GROUP, (_full, inner: string) => {
    const kept = (inner.match(SINGLE_MARKER) ?? []).filter((marker) => allowed.has(marker));
    return kept.length > 0 ? `[${kept.join(', ')}]` : '';
  });
  return tidyAfterRemoval(stripped.replace(/[ \t]*/g, ''));
}

/** Split into sentences, keeping each one exactly as it appears in the source text. */
function verbatimSentences(text: string): string[] {
  // Break only after sentence punctuation followed by a space, or at a line break,
  // so a decimal point or an abbreviation inside a sentence does not split it.
  return text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

export const QUOTE_MAX_CHARS = 320;

/**
 * The part of the passage that the citing sentence most likely rests on, copied
 * word for word. When nothing overlaps, the opening of the passage is used.
 */
export function bestQuote(passageText: string, citingSentence: string): string {
  const wanted = terms(citingSentence);
  let best = '';
  let bestScore = -1;
  for (const sentence of verbatimSentences(passageText)) {
    const score = overlap(new Set(terms(sentence)), wanted);
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

const SYSTEM_SECTION = /^##\s+(?:References|About this report)\s*$/im;

function dropSystemSections(markdown: string): string {
  const lines = markdown.split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) skipping = SYSTEM_SECTION.test(line);
    if (!skipping) kept.push(line);
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
  const text = mapProse(withoutSystem, (prose) => {
    // A bare number in brackets was not issued by the lock. Left in, it would
    // read as a citation with no reference behind it and could be mistaken for
    // one of the numbers assigned below. Code is never touched.
    removed += (prose.match(/\[\d+\](?!\()/g) ?? []).length;
    const body = tidyAfterRemoval(prose.replace(/[ \t]*\[\d+\](?!\()/g, ''));
    const rewritten = body.replace(MARKER_GROUP, (_full, inner: string, offset: number) => {
      const numbers: number[] = [];
      for (const marker of inner.match(SINGLE_MARKER) ?? []) {
        const passage = byMarker.get(marker);
        const key = passage ? sourceKey(passage.source) || passage.chunkId : '';
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
        occurrences.push({ number, chunkId: passage.chunkId, quote: bestQuote(passage.text, sentenceBefore(body, offset)) });
        numbers.push(number);
      }
      return numbers.length > 0 ? numbers.map((number) => `[${number}]`).join('') : '\uE002';
    });
    return tidyAfterRemoval(rewritten.replace(/[ \t]*\uE002/g, ''));
  });
  const references = buildReferences(cited);
  const readCount = distinctSourceCount(passages.map((passage) => passage.source));
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
    const markers = `${section.title}\n${section.content}`.match(/\[\d+\]/g) ?? [];
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
