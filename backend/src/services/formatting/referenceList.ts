/**
 * The reference list a reader sees (slice 4, part 2).
 *
 * One entry per cited source, numbered in order of first citation. An entry
 * gives who wrote or published the source, its title, its date, what kind of
 * source it is in words, and its link. A detail that is not known is left out;
 * an entry never says "unknown" and never shows an empty slot.
 *
 * The numbers in the text are the same in every style. A style the user chose
 * decides how each entry is written, on the page and in every export. A named
 * style is written as that style writes a reference: it gives the day a web
 * page was read, in its own form, and has no place for the kind of source, so
 * the kind in words appears in the numbered default only.
 *
 * Pure functions: no database, no clock, no model.
 */
import { parseAuthor, type CslAuthor } from './cslConverter';

export const REFERENCE_STYLES = ['numeric', 'apa', 'mla', 'chicago-author-date', 'chicago-note', 'ieee', 'harvard'] as const;
export type ReferenceStyle = (typeof REFERENCE_STYLES)[number];

export interface ReferenceSource {
  title: string;
  authors?: string[] | null;
  publisher?: string | null;
  /** The day the source was published, as YYYY-MM-DD. */
  date?: string | null;
  url?: string | null;
  /** What kind of source this is, in words a reader would use. */
  kind?: string | null;
  /** The day the source was read, as YYYY-MM-DD. Shown for web pages. */
  accessed?: string | null;
}

/** A style the user chose, or the numbered default when none was chosen or the value is not one we know. */
export function resolveReferenceStyle(raw: unknown): ReferenceStyle {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (REFERENCE_STYLES as readonly string[]).includes(value) ? (value as ReferenceStyle) : 'numeric';
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', trade: '™', reg: '®', copy: '©',
};

/** "&#x2122;" and "&amp;" as the characters they stand for. A page title is stored as its markup wrote it. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|([a-z]{2,8}));/gi, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = hex ? parseInt(hex, 16) : Number(dec);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
    try {
      return String.fromCodePoint(code);
    } catch {
      return whole;
    }
  });
}

/**
 * A title, name or publisher from a provider's record as plain text. Entities
 * are decoded, markup is taken out ("<i>In vivo</i>" reads "In vivo"), and an
 * angle bracket that is left is written as an entity. The reference list is
 * Markdown, which carries raw HTML into an HTML export, so a field that came
 * from outside must never be able to open a tag.
 */
export function plainFieldText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/<\/?[a-z][^<>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * A stored title as a reader should see it. Markup entities are decoded, the
 * name of the program that saved a file ("Microsoft Word - ") and a trailing
 * file extension are taken off, and the text is kept to one line.
 */
export function cleanSourceTitle(title: string): string {
  return plainFieldText(title)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:Microsoft (?:Word|PowerPoint|Excel)|Adobe Acrobat)\s*[-–—:]\s*/i, '')
    .replace(/\.(?:docx?|pdf|pptx?|xlsx?|rtf|txt|html?)$/i, '')
    .trim();
}

/** The site a page is on, for a page that names no publisher: "www.fda.gov/x" is "fda.gov". */
export function siteName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * What kind of source this is, in words. The provider's own record of what the
 * work is comes first ("journal article", "preprint", "book chapter"). Without
 * one it is read from where the source came from. Nothing here says a work was
 * peer reviewed: a catalogue entry or a DOI does not establish that, and a
 * journal article is called a journal article. Ranking sources by authority is
 * slice 6.
 */
export function sourceKindInWords(input: { kind?: string | null; provider?: string | null; url?: string | null; hasFile?: boolean }): string {
  const recorded = (input.kind ?? '').trim().toLowerCase();
  if (/^[a-z][a-z -]{2,39}$/.test(recorded)) return recorded;
  const provider = (input.provider ?? '').toLowerCase();
  const host = siteName(input.url) ?? '';
  if (provider === 'arxiv' || host === 'arxiv.org' || host.endsWith('.arxiv.org')) return 'preprint';
  if (provider === 'pmc' || (host === 'ncbi.nlm.nih.gov' && /\/pmc\//i.test(input.url ?? ''))) return 'journal article';
  // A DOI names a published work of some kind: an article, a book, a dataset, a report.
  if (provider === 'crossref' || provider === 'openalex' || host === 'doi.org' || host === 'dx.doi.org') return 'scholarly work';
  if (provider === 'clinicaltrials' || host === 'clinicaltrials.gov') return 'clinical trial record';
  if (provider === 'uspto' || host === 'patents.google.com' || host.endsWith('uspto.gov')) return 'patent record';
  if (!input.url) return input.hasFile ? 'uploaded document' : 'document';
  return 'web page';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface DayParts {
  year: number;
  month: number;
  day: number;
}

function dayParts(iso: string | null | undefined): DayParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

const shortMonth = (parts: DayParts): string => MONTHS[parts.month - 1].slice(0, 3);
const longMonth = (parts: DayParts): string => MONTHS[parts.month - 1];
/** "8 Dec 2023" */
const dayMonthYear = (parts: DayParts): string => `${parts.day} ${shortMonth(parts)} ${parts.year}`;
/** "December 8, 2023" */
const monthDayYear = (parts: DayParts): string => `${longMonth(parts)} ${parts.day}, ${parts.year}`;

function initials(given: string | undefined): string {
  return (given ?? '')
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(' ');
}

function parsedAuthors(source: ReferenceSource): CslAuthor[] {
  return (source.authors ?? [])
    .map((author) => (typeof author === 'string' ? parseAuthor(plainFieldText(author)) : null))
    .filter((author): author is CslAuthor => author !== null);
}

const givenFamily = (author: CslAuthor): string => author.literal ?? [author.given, author.family].filter(Boolean).join(' ');
const familyGiven = (author: CslAuthor): string => author.literal ?? [author.family, author.given].filter(Boolean).join(', ');
const familyInitials = (author: CslAuthor): string => author.literal ?? [author.family, initials(author.given)].filter(Boolean).join(', ');
const initialsFamily = (author: CslAuthor): string => author.literal ?? [initials(author.given), author.family].filter(Boolean).join(' ');

/** "A", "A and B", "A, B, and C". */
function joinNames(names: string[], and = 'and'): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} ${and} ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, ${and} ${names[names.length - 1]}`;
}

/** A piece of an entry closed with a full stop, unless it already ends a sentence. */
function closed(part: string): string {
  const text = part.trim();
  return /[.!?]["”')]?$/.test(text) ? text : `${text}.`;
}

function sentenceCase(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

interface Resolved {
  authors: CslAuthor[];
  /** Publisher, or the site a page is on when it names none. */
  publisher: string | null;
  title: string;
  published: DayParts | null;
  /** A date that is not a calendar day ("December 2023", "2019"), kept as the source gave it. */
  publishedText: string | null;
  /** The year of publication, from either form. */
  year: string | null;
  accessed: DayParts | null;
  url: string | null;
  kind: string | null;
}

function resolve(source: ReferenceSource): Resolved {
  const url = source.url?.trim() || null;
  const publisher = source.publisher?.trim() || siteName(url);
  return {
    authors: parsedAuthors(source),
    publisher: publisher ? cleanSourceTitle(publisher) : null,
    title: cleanSourceTitle(source.title || '') || 'Untitled source',
    published: dayParts(source.date),
    publishedText: dayParts(source.date) ? null : source.date?.trim() || null,
    year: dayParts(source.date) ? String(dayParts(source.date)?.year) : (/\b(\d{4})\b/.exec(source.date ?? '')?.[1] ?? null),
    accessed: dayParts(source.accessed),
    url,
    kind: source.kind?.trim() || null,
  };
}

function numericEntry(r: Resolved): string {
  const names = r.authors.map(givenFamily);
  const lead = names.length > 3 ? `${names[0]} et al.` : joinNames(names);
  const parts: string[] = [];
  if (lead) parts.push(closed(lead));
  else if (r.publisher) parts.push(closed(r.publisher));
  parts.push(closed(r.title));
  if (lead && r.publisher) parts.push(closed(r.publisher));
  if (r.published) parts.push(closed(dayMonthYear(r.published)));
  else if (r.publishedText) parts.push(closed(r.publishedText));
  if (r.kind) parts.push(closed(sentenceCase(r.kind)));
  if (r.url) parts.push(r.url);
  // A page can change after it is read; the day it was read is part of the reference.
  if (r.accessed && r.kind === 'web page') parts.push(`Accessed ${dayMonthYear(r.accessed)}.`);
  return parts.join(' ');
}

function apaEntry(r: Resolved): string {
  const names = r.authors.map(familyInitials);
  const lead = names.length > 0 ? joinNames(names, '&') : r.publisher;
  const date = r.published ? `(${r.published.year}, ${longMonth(r.published)} ${r.published.day})` : r.publishedText ? `(${r.publishedText})` : '(n.d.)';
  const parts: string[] = [];
  if (lead) parts.push(closed(lead));
  // The bracket is followed by a full stop whatever it holds: "(n.d.)." is the form.
  parts.push(`${date}.`);
  parts.push(closed(r.title));
  if (names.length > 0 && r.publisher) parts.push(closed(r.publisher));
  // A page can change after it is read, so the day it was read is given with its address.
  if (r.url) parts.push(r.accessed && r.kind === 'web page' ? `Retrieved ${monthDayYear(r.accessed)}, from ${r.url}` : r.url);
  return parts.join(' ');
}

function mlaEntry(r: Resolved): string {
  const lead =
    r.authors.length === 0
      ? ''
      : r.authors.length === 1
        ? familyGiven(r.authors[0])
        : r.authors.length === 2
          ? `${familyGiven(r.authors[0])}, and ${givenFamily(r.authors[1])}`
          : `${familyGiven(r.authors[0])}, et al.`;
  const parts: string[] = [];
  if (lead) parts.push(closed(lead));
  parts.push(`"${closed(r.title)}"`);
  const tail = [r.publisher, r.published ? `${r.published.day} ${shortMonth(r.published)}. ${r.published.year}` : r.publishedText, r.url].filter(Boolean).join(', ');
  if (tail) parts.push(closed(tail));
  if (r.accessed && r.kind === 'web page') parts.push(`Accessed ${r.accessed.day} ${shortMonth(r.accessed)}. ${r.accessed.year}.`);
  return parts.join(' ');
}

function chicagoNames(authors: CslAuthor[]): string {
  if (authors.length === 0) return '';
  return joinNames([familyGiven(authors[0]), ...authors.slice(1).map(givenFamily)]);
}

function chicagoAuthorDateEntry(r: Resolved): string {
  const lead = chicagoNames(r.authors) || r.publisher || '';
  const parts: string[] = [];
  if (lead) parts.push(closed(lead));
  if (r.year) parts.push(closed(r.year));
  parts.push(`"${closed(r.title)}"`);
  if (r.authors.length > 0 && r.publisher) parts.push(closed(r.publisher));
  if (r.published) parts.push(closed(`${longMonth(r.published)} ${r.published.day}`));
  if (r.accessed && r.kind === 'web page') parts.push(`Accessed ${monthDayYear(r.accessed)}.`);
  if (r.url) parts.push(closed(r.url));
  return parts.join(' ');
}

function chicagoNoteEntry(r: Resolved): string {
  const names = joinNames(r.authors.map(givenFamily));
  const accessed = r.accessed && r.kind === 'web page' ? `accessed ${monthDayYear(r.accessed)}` : null;
  const pieces = [names || null, `"${r.title},"`, r.publisher, r.published ? monthDayYear(r.published) : r.publishedText, accessed, r.url].filter(Boolean) as string[];
  // The title carries its own comma inside the quotation mark.
  return closed(pieces.join(', ').replace(/,",/g, ',"').replace(/,"$/, '."'));
}

function ieeeEntry(r: Resolved): string {
  const names = joinNames(r.authors.map(initialsFamily));
  const head = [names || r.publisher, `"${r.title},"`].filter(Boolean).join(', ');
  const middle = [names ? r.publisher : null, r.published ? `${shortMonth(r.published)}. ${r.published.day}, ${r.published.year}` : r.publishedText].filter(Boolean).join(', ');
  const parts = [closed(`${head}${middle ? ` ${middle}` : ''}`.replace(/,"\s*$/, '."'))];
  if (r.url && r.accessed && r.kind === 'web page') parts.push(`Accessed: ${shortMonth(r.accessed)}. ${r.accessed.day}, ${r.accessed.year}.`);
  if (r.url) parts.push(`[Online]. Available: ${r.url}`);
  return parts.join(' ');
}

function harvardEntry(r: Resolved): string {
  const names = joinNames(r.authors.map(familyInitials));
  const lead = names || r.publisher || '';
  const year = r.year ? `(${r.year})` : '(no date)';
  const parts: string[] = [[lead, year].filter(Boolean).join(' '), closed(r.title)];
  if (names && r.publisher) parts.push(closed(r.publisher));
  if (r.url) parts.push(`Available at: ${r.url}`);
  if (r.accessed && r.kind === 'web page') parts.push(`(Accessed: ${r.accessed.day} ${longMonth(r.accessed)} ${r.accessed.year}).`);
  return parts.join(' ');
}

/** One source as one line of the reference list, without its number. */
export function formatReference(source: ReferenceSource, style: ReferenceStyle = 'numeric'): string {
  const resolved = resolve(source);
  switch (style) {
    case 'apa':
      return apaEntry(resolved);
    case 'mla':
      return mlaEntry(resolved);
    case 'chicago-author-date':
      return chicagoAuthorDateEntry(resolved);
    case 'chicago-note':
      return chicagoNoteEntry(resolved);
    case 'ieee':
      return ieeeEntry(resolved);
    case 'harvard':
      return harvardEntry(resolved);
    default:
      return numericEntry(resolved);
  }
}

/** The numbered list, one source per line, in the order given. Empty when nothing is cited. */
export function formatReferenceList(sources: ReferenceSource[], style: ReferenceStyle = 'numeric'): string {
  return sources.map((source, index) => `${index + 1}. ${formatReference(source, style)}`).join('\n');
}
