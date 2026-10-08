/**
 * Exporting a report that was written with the citation lock (slice 4, part 2).
 *
 * Such a report already carries its reader numbers and its reference list in
 * the saved text, each number tied to a saved citation. An export shows that
 * text as it is. The export engine's own aliases and bibliography are not used:
 * nothing in the text refers to them, and adding them printed a second, empty
 * reference heading under the real one.
 *
 * When an export asks for another reference style than the one the report was
 * saved in, only the reference list is written again, in that style, from the
 * sources behind the saved citations. The numbers in the text do not change.
 */
import { formatReferenceList, describeSourceKind, type ReferenceSource, type ReferenceStyle } from './referenceList';

export interface LockedCitationSourceRow {
  /** The reader number as saved: "[3]". */
  citation_text: string | null;
  title: string | null;
  authors: string[] | null;
  publication: string | null;
  published_at: unknown;
  url: string | null;
  original_filename: string | null;
  retrieval_timestamp: unknown;
  provider: string | null;
  kind?: string | null;
}

function isoDayOf(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * The cited sources in number order, from the saved citations given in reading
 * order. The first citation that carries a number names its source: where two
 * stored copies of one article share a number, the first one cited is the entry.
 * Null when the numbers are not exactly 1 to N, in which case nothing can be
 * rebuilt safely and the saved list is kept.
 */
export function sourcesByNumber(rows: LockedCitationSourceRow[], options: { authorityWords?: boolean } = {}): ReferenceSource[] | null {
  const byNumber = new Map<number, ReferenceSource>();
  for (const row of rows) {
    const match = /^\[(\d+)\]$/.exec((row.citation_text ?? '').trim());
    if (!match) return null;
    const number = Number(match[1]);
    if (byNumber.has(number)) continue;
    const authors = Array.isArray(row.authors) ? row.authors.filter((author) => typeof author === 'string' && author.trim().length > 0) : [];
    const described = describeSourceKind({ kind: row.kind, provider: row.provider, url: row.url, hasFile: Boolean(row.original_filename), authorityWords: options.authorityWords === true });
    byNumber.set(number, {
      title: (row.title ?? '').replace(/\s+/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').replace(/^#+\s*/, '').trim() || row.url || 'Untitled source',
      authors: authors.length > 0 ? authors : null,
      publisher: row.publication,
      date: isoDayOf(row.published_at),
      url: row.url,
      kind: described.words,
      accessed: isoDayOf(row.retrieval_timestamp),
      ...(described.readFromWeb && described.words !== 'web page' ? { readFromWeb: true } : {}),
    });
  }
  const out: ReferenceSource[] = [];
  for (let number = 1; number <= byNumber.size; number += 1) {
    const source = byNumber.get(number);
    if (!source) return null;
    out.push(source);
  }
  return out;
}

/**
 * Where the generated reference list is. It is written last, so it is the last
 * section named "References"; a report may hold an earlier section of that name
 * (its own opening section, or one the writer chose), which is never the list.
 */
function referenceListIndex(sections: ReadonlyArray<{ title: string }>): number {
  for (let index = sections.length - 1; index > 0; index -= 1) {
    if (/^references$/i.test(sections[index].title.trim())) return index;
  }
  return -1;
}

/**
 * The saved sections with the reference list written in `style`. Returns the
 * sections unchanged when the list cannot be rebuilt: no list, no sources, or a
 * list whose length does not match the sources behind the citations.
 */
export function withReferenceStyle<T extends { title: string; content: string }>(
  sections: T[],
  sources: ReferenceSource[] | null,
  style: ReferenceStyle
): { sections: T[]; rebuilt: boolean } {
  if (!sources || sources.length === 0) return { sections, rebuilt: false };
  const at = referenceListIndex(sections);
  if (at === -1) return { sections, rebuilt: false };
  const savedEntries = sections[at].content.split('\n').filter((line) => /^\s*\d+\.\s+\S/.test(line)).length;
  if (savedEntries !== sources.length) return { sections, rebuilt: false };
  const next = sections.slice();
  next[at] = { ...sections[at], content: formatReferenceList(sources, style) };
  return { sections: next, rebuilt: true };
}
