/**
 * The reading page's model (slice 5). Pure functions: what goes on which tab,
 * and how a bracketed number in the text finds the passage behind it.
 */
import type { ReportSection } from '../../../utils/api';

export interface ReaderSource {
  id: string;
  title: string;
  publisher: string | null;
  authors: string[];
  date: string | null;
  url: string | null;
  kind: string;
  notice: string | null;
}

export interface ReaderCitation {
  sectionId: string | null;
  number: number | null;
  order: number;
  quote: string | null;
  sourceId: string | null;
}

export interface ReaderFinding {
  text: string;
  strength: string;
  sourceIds: string[];
  quotes: string[];
}

export interface ReaderEvidence {
  status: { word: string; reason: string | null };
  sources: ReaderSource[];
  citations: ReaderCitation[];
  findings: ReaderFinding[];
  /** An older report's passage labels and the reader numbers they become. */
  legacyLabels?: Record<string, number>;
}

export type SectionRole = 'title' | 'references' | 'about' | 'challenge' | 'report';

const norm = (text: string): string => text.replace(/[\s#*_]+/g, ' ').trim().toLowerCase();

/** Where a stored section is shown. The Challenge has its own tab; the rest is the report. */
export function sectionRole(section: ReportSection, reportTitle: string): SectionRole {
  const title = norm(section.title);
  if (!section.content.trim() && title === norm(reportTitle)) return 'title';
  if (/^(references|sources|bibliography|works cited)$/.test(title)) return 'references';
  if (/^about this report$/.test(title)) return 'about';
  if (/^challenge\b|^the challenge\b|^adversarial (review|challenge)\b/.test(title) || section.section_type === 'challenge') return 'challenge';
  return 'report';
}

export interface ReferenceEntry {
  number: number;
  text: string;
}

/** The numbered reference list as written: "3. Author. Title. …". Lines that are not entries are kept with the entry above. */
export function parseReferences(content: string): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  for (const line of content.split('\n')) {
    const match = /^\s*(?:\[(\d+)\]|(\d+)[.)])\s+(.*\S)\s*$/.exec(line);
    if (match) entries.push({ number: Number(match[1] ?? match[2]), text: match[3] });
    else if (line.trim() && entries.length > 0) entries[entries.length - 1].text += ` ${line.trim()}`;
  }
  return entries;
}

/** Anchor a citation link points at. Read back by the renderer. */
export const CITE_HREF = '#cite-';
export const citeHref = (order: number): string => `${CITE_HREF}${order}`;
export const referenceAnchor = (number: number): string => `reference-${number}`;

const FENCE = /(```[\s\S]*?```|`[^`\n]*`)/g;
const NUMBER_GROUP = /\[(\d+(?:\s*[,;]\s*\d+)*)\](?!\()/g;
/** A passage label from before citations were numbered: "[Chunk 3]", "(Chunks 3, 7)", "Chunk 12". */
const LEGACY_GROUP = /[[(]\s*chunks?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s*[\])]|\bchunks?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)\b/gi;

/**
 * Turn each bracketed number into a link the page renders as a citation
 * marker. The k-th time a number appears in a section it is the k-th saved
 * citation with that number in that section; past the saved ones, or in a
 * section with none, it is any saved citation with that number. A number with
 * no saved citation stays as plain text.
 *
 * Older reports wrote passage labels ("[Chunk 3]"). Where the saved citations
 * map a label to a reader number it becomes that number; where they do not it
 * is taken out. No report shows "Chunk".
 */
export function linkCitations(markdown: string, sectionId: string | null, citations: ReaderCitation[], legacyNumbers: ReadonlyMap<number, number> = new Map()): string {
  const here = citations.filter((citation) => citation.sectionId === sectionId).sort((a, b) => a.order - b.order);
  const used = new Set<number>();
  const pick = (number: number): ReaderCitation | undefined => {
    const next = here.find((citation) => citation.number === number && !used.has(citation.order));
    if (next) {
      used.add(next.order);
      return next;
    }
    return here.find((citation) => citation.number === number) ?? citations.find((citation) => citation.number === number);
  };
  const marker = (number: number): string => {
    const found = pick(number);
    return found ? `[${number}](${citeHref(found.order)})` : `[${number}]`;
  };
  return markdown
    .split(FENCE)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      const numbered = part.replace(LEGACY_GROUP, (_whole, bracketed: string | undefined, bare: string | undefined) => {
        const mapped = (bracketed ?? bare ?? '')
          .split(/\s*(?:,|and|&)\s*/)
          .map((label) => legacyNumbers.get(Number(label)))
          .filter((number): number is number => typeof number === 'number');
        return mapped.length > 0 ? [...new Set(mapped)].map((number) => `[${number}]`).join('') : '';
      });
      return numbered
        .replace(NUMBER_GROUP, (_whole, group: string) => group.split(/\s*[,;]\s*/).map((number) => marker(Number(number))).join(''))
        // What a removed label leaves behind: a doubled space, a space before punctuation, empty brackets.
        .replace(/\(\s*\)|\[\s*\]/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([.,;:])/g, '$1');
    })
    .join('');
}

/**
 * Reader numbers for an older report's passage labels, from its saved
 * citations: a citation saved as "[Chunk 7]" for a source is that source's
 * number, sources numbered in the order they are first cited.
 */
export function legacyNumbersFrom(rows: Array<{ citation_text?: string | null; source_id?: string | null; citation_order?: number | null }>): Map<number, number> {
  const numbers = new Map<number, number>();
  const bySource = new Map<string, number>();
  const ordered = [...rows].sort((a, b) => (a.citation_order ?? 0) - (b.citation_order ?? 0));
  for (const row of ordered) {
    const label = /chunks?\s+(\d+)/i.exec(row.citation_text ?? '');
    if (!label || !row.source_id) continue;
    if (!bySource.has(row.source_id)) bySource.set(row.source_id, bySource.size + 1);
    numbers.set(Number(label[1]), bySource.get(row.source_id)!);
  }
  return numbers;
}

/** What the hover card shows for one citation. */
export function citationCard(order: number, evidence: Pick<ReaderEvidence, 'citations' | 'sources'>): { number: number | null; quote: string | null; source: ReaderSource | null } | null {
  const citation = evidence.citations.find((entry) => entry.order === order);
  if (!citation) return null;
  return { number: citation.number, quote: citation.quote, source: evidence.sources.find((source) => source.id === citation.sourceId) ?? null };
}

export type ReaderTab = 'report' | 'evidence' | 'sources' | 'method' | 'challenge';

export const TAB_LABELS: Record<ReaderTab, string> = {
  report: 'Report',
  evidence: 'Evidence',
  sources: 'Sources',
  method: 'How this was researched',
  challenge: 'Challenge',
};

/** Tabs in order. The Challenge tab exists only for a report that has a Challenge section. */
export function tabsFor(sections: ReportSection[], reportTitle: string): ReaderTab[] {
  const hasChallenge = sections.some((section) => sectionRole(section, reportTitle) === 'challenge');
  return hasChallenge ? ['report', 'evidence', 'sources', 'method', 'challenge'] : ['report', 'evidence', 'sources', 'method'];
}

/** "8 Dec 2023" from "2023-12-08"; the text as given when it is not a day. */
export function readableDay(iso: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!match) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

/** The labels the backend mapped, as the lookup `linkCitations` takes. */
export function legacyNumbersOf(evidence: Pick<ReaderEvidence, 'legacyLabels'> | undefined): Map<number, number> {
  return new Map(Object.entries(evidence?.legacyLabels ?? {}).map(([label, number]) => [Number(label), number]));
}

/**
 * A section's heading and body with their citations linked together. A number
 * in a heading is a citation like any other, saved before the body's, so the
 * two are numbered in one pass and then parted again.
 */
export function linkSection(title: string, content: string, sectionId: string | null, citations: ReaderCitation[], legacyNumbers?: ReadonlyMap<number, number>): { heading: string; body: string } {
  const heading = title.replace(/\s+/g, ' ').trim();
  const linked = linkCitations(`${heading}\n${content}`, sectionId, citations, legacyNumbers);
  const at = linked.indexOf('\n');
  return at === -1 ? { heading: linked, body: '' } : { heading: linked.slice(0, at), body: linked.slice(at + 1) };
}

/**
 * The report as Markdown, as the Report tab shows it: for the download and
 * copy actions. The title once, the report's own sections, the reference list
 * and the closing note. No passage labels, and nothing from the other tabs.
 */
export function buildReaderMarkdown(report: { title: string; sections?: ReportSection[]; executive_summary?: string }, legacyNumbers: ReadonlyMap<number, number> = new Map()): string {
  const sections = [...(report.sections ?? [])].sort((a, b) => a.section_order - b.section_order);
  const lines: string[] = [`# ${report.title}`, ''];
  // With no saved citations to link to, linkCitations leaves numbers as written and only removes or renumbers labels.
  const plain = (text: string): string => linkCitations(text, null, [], legacyNumbers);
  const shown = sections.filter((section) => {
    const role = sectionRole(section, report.title);
    return role !== 'title' && role !== 'challenge';
  });
  // The heading gets the same handling as the body, as it does on the page.
  for (const section of shown) lines.push(`## ${plain(section.title).trim()}`, '', plain(section.content).trim(), '');
  if (shown.length === 0 && report.executive_summary) lines.push(plain(report.executive_summary).trim(), '');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
