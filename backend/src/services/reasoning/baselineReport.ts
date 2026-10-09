import { readerFacingLabelHits } from '../formatting/reportPresentation';
import { formatReferenceList, type ReferenceStyle } from '../formatting/referenceList';

export interface UsedSource {
  title: string;
  publisher?: string | null;
  date?: string | null;
  url?: string | null;
  /** Who wrote it, when the source says. */
  authors?: string[] | null;
  /** What kind of source it is, in words: "journal article", "web page". */
  kind?: string | null;
  /** The day it was read, as YYYY-MM-DD. */
  accessed?: string | null;
  /** Slice 6. A web page named by where it was read: still dated as a page that was read. */
  readFromWeb?: boolean;
}

const STRUCTURAL_HEADING =
  /^(overview|introduction|findings|analysis|conclusion|results|background|framing|recommendation|steps|comparison|summary|key findings|limits of this report|references|about this report|pending subject)$/i;

/** A heading a reader would write: not the question, not a structural label, a noun phrase. */
export function acceptSubjectHeading(query: string, heading: string): boolean {
  const title = heading.replace(/^#+\s*/, '').trim();
  // Scripts written without spaces between words carry a heading in few characters.
  const unspaced = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(title);
  if (title.length < (unspaced ? 3 : 8) || /[?？]/.test(title)) return false;
  const norm = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const headingNorm = norm(title);
  const queryNorm = norm(query);
  if (!headingNorm || headingNorm === queryNorm) return false;
  if (queryNorm.includes(headingNorm) || headingNorm.includes(queryNorm)) return false;
  if (/^(how|what|when|why|who|where)\b/.test(headingNorm)) return false;
  if (/\b(is described|the records show)\b/.test(headingNorm)) return false;
  if (STRUCTURAL_HEADING.test(title.trim())) return false;
  return unspaced || headingNorm.split(' ').length >= 2;
}

export function readerSections(intentId: string | undefined, _query = ''): Array<{ key: string; title: string; weight: number; system?: boolean }> {
  const body =
    intentId === 'survey'
      ? [
          { key: 'established', title: 'What is well established', weight: 1 },
          { key: 'contested', title: 'Where researchers disagree', weight: 1 },
          { key: 'open_questions', title: 'Open questions', weight: 1 },
        ]
      : intentId === 'how_to'
        ? [{ key: 'steps', title: 'Steps', weight: 1 }]
        : intentId === 'comparative'
          ? [{ key: 'comparison', title: 'Comparison', weight: 1 }]
          : [
              { key: 'topic_0', title: 'Pending subject', weight: 1 },
              { key: 'topic_1', title: 'Pending subject', weight: 1 },
              { key: 'disagreement', title: 'Where sources disagree', weight: 1 },
            ];
  return [
    { key: 'summary', title: 'Summary', weight: 1 },
    { key: 'key_findings', title: 'Key findings', weight: 1 },
    ...body,
    { key: 'limits', title: 'Limits of this report', weight: 1 },
    { key: 'references', title: 'References', weight: 1, system: true },
    { key: 'about', title: 'About this report', weight: 1, system: true },
  ];
}

export function draftedSections(intentId: string | undefined, query = ''): Array<{ key: string; title: string; weight: number }> {
  return readerSections(intentId, query).filter((section) => !section.system);
}

/** Remove a grade field or label. Ordinary words such as testimony stay. */
export function stripGradeLines(context: string): string {
  return context
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*evidence tier\s*:\s*\S+\s*$/i, '')
        .replace(/\b(?:established_fact|strong_evidence)\b:?/gi, '')
        .replace(/\[\s*(?:established_fact|strong_evidence|testimony|inference|speculation)\s*\]/gi, '')
    )
    .join('\n');
}

export function trimSummaryAtSentence(text: string, maxWords = 150): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  const cut = words.slice(0, maxWords).join(' ');
  const boundary = cut.match(/^[\s\S]*[.!?](?=\s|$)/);
  return (boundary?.[0] ?? cut).trim();
}

export function presentationFailures(text: string): string[] {
  return readerFacingLabelHits(text);
}

export function scorePresentationClean(text: string): number {
  return presentationFailures(text).length === 0 ? 1 : 0;
}

export const REQUIRED_READER_SECTIONS = ['Summary', 'Key findings', 'Limits of this report', 'References', 'About this report'];

/** A report under 300 words is the answer, its references when it cites any, and the closing note. */
export const SHORT_READER_SECTIONS = ['Summary', 'About this report'];

export function scoreStructureComplete(text: string, required?: string[]): number {
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? '');
  const words = text.replace(/^#+\s.*$/gm, '').split(/\s+/).filter(Boolean).length;
  const profile = required ?? (words < 300 && !headings.includes('Key findings') ? SHORT_READER_SECTIONS : REQUIRED_READER_SECTIONS);
  let cursor = 0;
  for (const title of profile) {
    const index = headings.findIndex((heading, position) => position >= cursor && heading === title);
    if (index === -1) return 0;
    cursor = index + 1;
  }
  const summary = text.split(/^##\s+Summary\s*$/m)[1]?.split(/^##\s+/m)[0] ?? '';
  return summary.trim().split(/\s+/).filter(Boolean).length <= 150 ? 1 : 0;
}

function proseBlocks(content: string): string[] {
  return content.split(/\n{2,}/).filter((block) => !block.trim().startsWith('```') && !block.includes('|'));
}

/** A citation marker is not part of the sentence it follows. */
export function sentenceKey(sentence: string): string {
  return sentence
    .replace(/\s*\[\s*(?:[EP])?\d+(?:\s*(?:[,;/&+–—-]|and|to)\s*P?\d+)*\s*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function repeatedSentences(sections: Array<{ content: string }>): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const section of sections) {
    for (const block of proseBlocks(section.content)) {
      for (const sentence of splitSentences(block)) {
        const key = sentenceKey(sentence);
        if (key.length < 40 || /^\[(?:e)?\d+\]$/.test(key)) continue;
        if (seen.has(key)) repeated.push(sentence.trim());
        seen.add(key);
      }
    }
  }
  return repeated;
}

export function scoreNoRepetition(sections: Array<{ content: string }>): number {
  return repeatedSentences(sections).length === 0 ? 1 : 0;
}

function isListBlock(block: string): boolean {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^([-*+]|\d+[.)])\s+/.test(line));
}

export function removeRepeatedSentences<T extends { content: string }>(sections: T[]): T[] {
  const seen = new Set<string>();
  return sections.map((section) => {
    const parts = section.content.split(/(\n{2,})/);
    const next = parts.map((part) => {
      if (/^\n{2,}$/.test(part)) return part;
      if (part.trim().startsWith('```') || part.includes('|')) return part;
      if (isListBlock(part)) {
        const lines = part.split('\n').filter((line) => {
          const key = sentenceKey(line);
          if (!key || key.length < 40) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return lines.join('\n');
      }
      const sentences = splitSentences(part);
      const kept: string[] = [];
      for (const sentence of sentences) {
        const key = sentenceKey(sentence);
        if (!key || /^\[(?:e)?\d+\]$/.test(key)) {
          if (kept.length > 0) kept[kept.length - 1] = `${kept[kept.length - 1]} ${sentence.trim()}`;
          continue;
        }
        if (key.length < 40) {
          kept.push(sentence);
          continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(sentence);
      }
      return kept.join(' ');
    });
    return { ...section, content: next.join('').trim() };
  });
}

export function readerTitle(query: string, proposed: string): string {
  return acceptSubjectHeading(query, proposed) ? proposed.trim() : 'Report';
}

const CONTESTED_REQUEST = /\b(prove|proof|debunk|hoax|cover[- ]?up|conspiracy|alleg\w*|claim\w*|verify|true that|really|fake|fraud|evidence (?:for|against|that)|did .* (?:lie|fake))\b/i;
const PLAIN_QUESTION = /^(who|what|when|where|which|how (?:many|much|old|long|far|tall|big)|in what year|on what date)\b/i;

/**
 * A classifier failure falls back to a factual report only when the request is
 * plainly a short factual question. Anything else keeps the failure, so a
 * request that needs adjudication is never quietly downgraded.
 */
export function plainQuestionIntent(classifierFailed: boolean, unsure: boolean, request = ''): 'factual_report' | null {
  if (!classifierFailed && !unsure) return null;
  const text = request.trim();
  if (!text || text.split(/\s+/).length > 30) return null;
  if (CONTESTED_REQUEST.test(text)) return null;
  return PLAIN_QUESTION.test(text) ? 'factual_report' : null;
}

/** A stored date as YYYY-MM-DD. The database driver hands back Date objects. */
export function isoDay(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** The numbered reference list, in the style the user chose or the numbered default. */
export function buildReferences(sources: UsedSource[], style: ReferenceStyle = 'numeric'): string {
  if (sources.length === 0) return '';
  return formatReferenceList(sources, style);
}

export function formatReadDate(date = new Date()): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Count and the date read. The section heading already names the note. */
export function buildAbout(readCount: number, readOn: string): string {
  if (readCount <= 0) return 'No sources were used.';
  const verb = readCount === 1 ? 'was' : 'were';
  return `${readCount} source${readCount === 1 ? '' : 's'} ${verb} read on ${readOn}.`;
}

export function sourceKey(source: UsedSource): string {
  return (source.url || source.title).trim().toLowerCase();
}

export function distinctSourceCount(sources: UsedSource[]): number {
  return new Set(sources.map(sourceKey).filter(Boolean)).size;
}

const UNRESOLVED_MARKER = '';

/** One number per cited source. Markers in the text are rewritten to match. */
export function renumberCitations<T extends { content: string }>(sections: T[], sources: UsedSource[]): { sections: T[]; cited: UsedSource[] } {
  const assigned = new Map<string, { source: UsedSource; number: number }>();
  const cited: UsedSource[] = [];
  const rewriteMarkers = (text: string) => text.replace(/\[(\d+)\]/g, (full, raw) => {
    // A marker with no source behind it would cite a reference that is not listed.
    const source = sources[Number(raw) - 1];
    if (!source) return UNRESOLVED_MARKER;
    const key = sourceKey(source);
    if (!key) return UNRESOLVED_MARKER;
    let entry = assigned.get(key);
    if (!entry) {
      entry = { source, number: cited.length + 1 };
      assigned.set(key, entry);
      cited.push(source);
    }
    return `[${entry.number}]`;
  });
  const rewrite = (text: string) =>
    rewriteMarkers(text)
      .replace(new RegExp(`[ \\t]*${UNRESOLVED_MARKER}`, 'g'), '')
      .replace(/[ \t]+([.,;:!?])/g, '$1');
  return { sections: sections.map((section) => ({ ...section, content: rewrite(section.content) })), cited };
}

export function citedSources(text: string, sources: UsedSource[]): UsedSource[] {
  const indexes = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])))]
    .filter((index) => index >= 1 && index <= sources.length)
    .sort((a, b) => a - b);
  const seen = new Set<string>();
  const cited: UsedSource[] = [];
  for (const index of indexes) {
    const source = sources[index - 1];
    if (!source) continue;
    const key = (source.url || source.title).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cited.push(source);
  }
  return cited;
}

export function parseRewrittenSections<T extends { title: string; content: string }>(markdown: string, originals: T[]): T[] | null {
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  if (matches.length === 0) return null;
  const byTitle = new Map<string, string>();
  for (let i = 0; i < matches.length; i += 1) {
    const title = matches[i][1]?.trim() ?? '';
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length;
    byTitle.set(title.toLowerCase(), markdown.slice(start, end).trim());
  }
  if (originals.some((section) => !byTitle.has(section.title.toLowerCase()))) return null;
  return originals.map((section) => ({ ...section, content: byTitle.get(section.title.toLowerCase()) ?? section.content }));
}

export function sectionsToMarkdown(sections: Array<{ title: string; content: string }>, title?: string): string {
  const body = sections.map((section) => `## ${section.title}\n${section.content}`).join('\n\n');
  return title ? `# ${title}\n\n${body}` : body;
}

/**
 * Sentences of a paragraph.
 *
 * A full stop does not always end a sentence, and reading a boundary where
 * there is none cuts a sentence in two; the half that repeats an earlier
 * sentence is then removed from the middle of its own. A full stop is not a
 * boundary when what follows cannot start a sentence, or when what precedes it
 * is a form that is followed by the rest of its phrase:
 *
 * - the next word starts with a lower-case letter ("et al. reporting that…");
 * - a title or a reference word that always has something after it
 *   ("Dr. Chen", "Fig. 3", "e.g. France", "vs. Korea");
 * - a single initial where a name can stand, before a capitalised word
 *   ("J. R. Lovering", "by A. Yip"), but not a letter label ("option A.");
 * - "et al.", "etc.", "Inc." and the like, or a dotted abbreviation ("U.S."),
 *   but only when a number or a bracket follows ("et al. (2016)", "U.S. [3]").
 *   Before a capitalised word these do end sentences ("…built in the U.S.
 *   Later units cost more."), and merging there would hide a real sentence
 *   from the limits cap and from the repetition check.
 *
 * Scripts without letter case are split at every full stop.
 */
const ALWAYS_CONTINUES = /\b(?:e\.g|i\.e|vs|cf|Mr|Mrs|Ms|Dr|Prof|St|Fig|No|approx)\.$/;
/**
 * A single capital and a full stop is an initial only where a name can stand:
 * at the start, after another initial or a capitalised word ("Jessica R."),
 * after a comma or bracket, or after a word that introduces a person ("by J.").
 * After an ordinary word it is a label that ends the sentence ("option A.",
 * "vitamin C."), and so it is after a word that takes a letter label
 * ("Appendix B.", "Table A.").
 */
const LETTER_LABEL_WORD = /^(?:appendix|annex|table|figure|section|option|part|phase|plan|type|group|class|grade|category|exhibit|schedule|vitamin|hepatitis|level|tier|series|model|unit|block|zone|stage|step|item|case|variant|scenario)$/i;
function endsWithNameInitial(text: string): boolean {
  const match = /(?:^|(\S+)\s+)\p{Lu}\.$/u.exec(text);
  if (!match) return false;
  const before = match[1];
  if (before === undefined) return true;
  if (/[,;:(\[—–-]$/.test(before)) return true;
  const word = before.replace(/^[("'“‘[]+/, '');
  if (LETTER_LABEL_WORD.test(word)) return false;
  if (/^\p{Lu}\.$/u.test(word)) return true;
  if (/^(?:by|and|with|from|per|see|of|to|for|as|author|authors|editor|editors)$/i.test(word)) return true;
  return /^\p{Lu}\p{Ll}/u.test(word);
}
const MAY_END_SENTENCE = /(?:\b(?:et al|etc|Inc|Ltd|Co|Corp)|\b(?:\p{Lu}\.){1,}\p{Lu})\.$/u;

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/(?<=[.!?])\s+/)) {
    const last = out[out.length - 1];
    const continues =
      last !== undefined &&
      (/^\p{Ll}/u.test(piece) ||
        ALWAYS_CONTINUES.test(last) ||
        (endsWithNameInitial(last) && /^\p{Lu}/u.test(piece)) ||
        (MAY_END_SENTENCE.test(last) && /^[\p{N}([]/u.test(piece)));
    if (continues) out[out.length - 1] = `${last} ${piece}`;
    else out.push(piece);
  }
  return out;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Sections whose size does not depend on the subject (report standard): the
 * summary, the key findings, the note on disagreement and the limits. Together
 * they take at most this share of a report, so the body is never squeezed out.
 */
const FIXED_SECTION_WORDS: Readonly<Record<string, number>> = { summary: 150, key_findings: 180, disagreement: 220, limits: 90, limitations: 90 };

/** The limits note under either of its keys: the reader plan calls it `limits`, the literature-review plan `limitations`. */
export function isLimitsSection(key: string): boolean {
  return key === 'limits' || key === 'limitations';
}
const FIXED_SHARE_CEILING = 0.4;
const BODY_SECTION_FLOOR = 80;

/**
 * Words each drafted section may use. The fixed sections keep their own size
 * (scaled down in a short report); the subject sections share what is left.
 * An even split gave a 150-word summary and a 90-word limits note the same
 * 600 words as a subject section, and the writer filled them.
 */
export function readerSectionBudgets(totalWords: number, plan: ReadonlyArray<{ key: string }>): Map<string, number> {
  const fixed = plan.filter((section) => FIXED_SECTION_WORDS[section.key] !== undefined);
  const body = plan.filter((section) => FIXED_SECTION_WORDS[section.key] === undefined);
  const budgets = new Map<string, number>();
  const fixedWanted = fixed.reduce((sum, section) => sum + FIXED_SECTION_WORDS[section.key], 0);
  if (body.length === 0) {
    const scale = fixedWanted > 0 ? Math.min(1, totalWords / fixedWanted) : 1;
    for (const section of fixed) budgets.set(section.key, Math.max(1, Math.round(FIXED_SECTION_WORDS[section.key] * scale)));
    return budgets;
  }
  const fixedShare = Math.min(fixedWanted, totalWords * FIXED_SHARE_CEILING);
  const scale = fixedWanted > 0 ? fixedShare / fixedWanted : 0;
  for (const section of fixed) budgets.set(section.key, Math.max(1, Math.round(FIXED_SECTION_WORDS[section.key] * scale)));
  const perBody = Math.max(BODY_SECTION_FLOOR, Math.round((totalWords - fixedShare) / body.length));
  for (const section of body) budgets.set(section.key, perBody);
  return budgets;
}

/** What each fixed section must look like, told to the writer in the words of the report standard. */
export function readerSectionRule(key: string): string {
  if (key === 'key_findings') {
    return 'Write 3 to 7 bullet points and nothing else. Each bullet starts with "- ", is one sentence, and ends with its citation. No introduction, no paragraphs, no closing line.';
  }
  if (isLimitsSection(key)) {
    return 'Write two to four sentences that name only real limits of this report, such as a period the sources do not cover or a point they leave unsettled. Do not restate findings. Do not describe what the report chose not to do.';
  }
  if (key === 'summary') return '';
  return 'The summary and key findings are already written. Do not retell them; give the detail they leave out. State each fact once in this report.';
}

/**
 * Sections whose length is the writer's to manage and may be held to a share of
 * the report: the key findings, the subject sections, the note on disagreement
 * and the limits. The steps of a how-to and the table of a comparison are as
 * long as their subject makes them, and a section a request asked for by name
 * (one per item, a named deliverable) is sized by that request; none of those
 * is shortened here.
 */
export function isSizedReaderSection(key: string): boolean {
  return /^(?:key_findings|limits|limitations|disagreement|established|contested|open_questions|topic_\d+)$/.test(key);
}

/** A list and nothing else: every non-empty line is a bullet. */
export function isBulletList(content: string): boolean {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^[-*+]\s+\S/.test(line));
}

/** Keep the first `max` bullets of a list. Anything that is not a list is returned as written. */
export function capBullets(content: string, max = 7): string {
  if (!isBulletList(content)) return content;
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  return lines.slice(0, max).join('\n');
}

/**
 * Cut a section to a word limit at a boundary a reader would accept: whole
 * paragraphs first, then whole sentences or list lines. A table or a code block
 * is never cut and never dropped. At least the opening sentence always stays. A
 * citation sits inside its sentence, so it leaves only with the sentence.
 */
export function trimToWords(content: string, maxWords: number): string {
  if (wordCount(content) <= maxWords) return content;
  const blocks = content.split(/\n{2,}/);
  const kept: string[] = [];
  let used = 0;
  for (const block of blocks) {
    const size = wordCount(block);
    if (used + size <= maxWords) {
      kept.push(block);
      used += size;
      continue;
    }
    const whole = block.trim().startsWith('```') || block.includes('|');
    if (!whole) {
      const list = isListBlock(block);
      const units = list ? block.split('\n') : splitSentences(block);
      const part: string[] = [];
      for (const unit of units) {
        const unitSize = wordCount(unit);
        if (used + unitSize > maxWords && (kept.length > 0 || part.length > 0)) break;
        part.push(unit);
        used += unitSize;
      }
      if (part.length > 0) kept.push(part.join(list ? '\n' : ' '));
    } else {
      // A table or a code sample is the content the section exists for. It is
      // never cut and never dropped; the section ends with it instead.
      kept.push(block);
    }
    break;
  }
  return kept.join('\n\n').trim();
}

/** The size a section has whatever the length of the report, or undefined for a section sized by the report. */
export function fixedSectionWords(key: string): number | undefined {
  return FIXED_SECTION_WORDS[key];
}

/**
 * Prose written as a list, one sentence to a bullet, at most `max`. For key
 * findings a writer returned as paragraphs twice: the sentences and their
 * citations are kept as they are and only the shape changes.
 */
export function sentencesAsBullets(content: string, max = 7): string {
  if (isBulletList(content.trim())) return capBullets(content.trim(), max);
  const sentences: string[] = [];
  for (const block of content.split(/\n{2,}/)) {
    if (!block.trim() || block.trim().startsWith('```') || block.includes('|')) continue;
    const lines = isListBlock(block) ? block.split('\n').map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')) : splitSentences(block.replace(/\s*\n\s*/g, ' ').trim());
    for (const line of lines) if (line.trim()) sentences.push(line.trim());
  }
  if (sentences.length === 0) return content;
  return sentences.slice(0, max).map((sentence) => `- ${sentence}`).join('\n');
}

/**
 * The items of a section that is a list and nothing else, each with the lines
 * that continue it, or null when the section is not such a list. A line that
 * does not open an item continues the one above it; after a blank line it must
 * be indented to do so, as Markdown requires. `whole` is false when prose
 * follows the list. Null when the section does not open with a list.
 */
function listItems(content: string): { items: string[]; whole: boolean } | null {
  const items: string[][] = [];
  let afterBlank = false;
  let whole = true;
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      afterBlank = true;
      continue;
    }
    if (/^(?:[-*+]|\d+[.)])\s+\S/.test(line)) {
      items.push([line]);
    } else {
      const current = items[items.length - 1];
      if (!current) return null;
      if (line.trim().startsWith('```') || (afterBlank && !/^\s{2,}\S/.test(line))) {
        // Prose after the list: the items read so far are the note.
        whole = false;
        break;
      }
      if (afterBlank) current.push('');
      current.push(line);
    }
    afterBlank = false;
  }
  return items.length > 0 ? { items: items.map((lines) => lines.join('\n')), whole } : null;
}

/**
 * The first `max` sentences of a section, for a note that must stay a note. A
 * note that opens with a list keeps whole items up to `max` sentences in all; a
 * closing line after the list is dropped, not kept in place of the limits themselves.
 */
export function firstSentences(content: string, max: number): string {
  const list = listItems(content);
  if (list) {
    // The limit is on sentences, however they are set out: items are kept whole
    // while the sentences in them stay within it, and the first is always kept.
    const kept: string[] = [];
    let sentences = 0;
    for (const item of list.items) {
      const text = item.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/\s*\n\s*/g, ' ').trim();
      const count = Math.max(1, splitSentences(text).length);
      if (kept.length > 0 && sentences + count > max) break;
      kept.push(item);
      sentences += count;
    }
    return kept.join('\n');
  }
  const blocks = content.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  const out: string[] = [];
  for (const block of blocks) {
    if (block.trim().startsWith('```') || block.includes('|') || isListBlock(block)) continue;
    for (const sentence of splitSentences(block.replace(/\s*\n\s*/g, ' ').trim())) {
      if (out.length >= max) return out.join(' ');
      if (sentence.trim()) out.push(sentence.trim());
    }
  }
  return out.length > 0 ? out.join(' ') : content;
}

/**
 * Sections brought back inside the length of the report. Each section may run
 * a little past its own share, and several doing so at once put a report well
 * past its length. When the whole is over `target`, the sections that are past
 * their share give up what they are over by, in proportion, at a sentence end.
 * A section inside its share is never touched, and neither is one `mayTrim`
 * excludes (the steps of a how-to, a section a request named).
 */
export function fitToTotal<T extends { key: string; content: string }>(
  sections: T[],
  target: number,
  shareOf: (key: string) => number,
  mayTrim: (key: string) => boolean
): T[] {
  const words = sections.map((section) => wordCount(section.content));
  const over = words.reduce((sum, count) => sum + count, 0) - target;
  if (over <= 0) return sections;
  const excess = sections.map((section, index) => (mayTrim(section.key) ? Math.max(0, words[index] - shareOf(section.key)) : 0));
  const totalExcess = excess.reduce((sum, count) => sum + count, 0);
  if (totalExcess === 0) return sections;
  const share = Math.min(1, over / totalExcess);
  return sections.map((section, index) => {
    if (excess[index] === 0) return section;
    const content = trimToWords(section.content, Math.round(words[index] - excess[index] * share));
    return content === section.content ? section : { ...section, content };
  });
}
