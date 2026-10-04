import { baselineLayerEnabled } from '../../config';
import { readerFacingLabelHits } from '../formatting/reportPresentation';

export interface UsedSource {
  title: string;
  publisher?: string | null;
  date?: string | null;
  url?: string | null;
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
    .replace(/\s*\[\s*(?:[EP])?\d+(?:\s*(?:[,;/&+\u2013\u2014-]|and|to)\s*P?\d+)*\s*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function repeatedSentences(sections: Array<{ content: string }>): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const section of sections) {
    for (const block of proseBlocks(section.content)) {
      for (const sentence of block.split(/(?<=[.!?])\s+/)) {
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
      const sentences = part.split(/(?<=[.!?])\s+/);
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
  if (!baselineLayerEnabled()) return null;
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

export function buildReferences(sources: UsedSource[]): string {
  if (sources.length === 0) return '';
  return sources
    .map((source, index) => {
      const parts = [source.publisher, source.title, source.date].filter(Boolean);
      return `${index + 1}. ${parts.join(', ')}${source.url ? ` ${source.url}` : ''}`;
    })
    .join('\n');
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

const UNRESOLVED_MARKER = '\uE001';

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
