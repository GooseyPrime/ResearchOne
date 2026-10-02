/**
 * Aliases the section writer may emit. [E#] is internal.
 * Reader numbers are assigned later, one per source, in first-citation order.
 */
export interface IssuedAlias {
  alias: string;
  chunkId: string;
  quote: string;
  sourceKey: string;
  title: string;
  authors: string | null;
  publisher: string | null;
  date: string | null;
  url: string | null;
  doi: string | null;
  provider: string | null;
}

export function issueAliases(
  chunks: Array<{
    id: string;
    content: string;
    source_url?: string | null;
    source_title?: string | null;
    source_publisher?: string | null;
    source_published_at?: string | Date | null;
    authors?: string | null;
    doi?: string | null;
    provider?: string | null;
  }>
): IssuedAlias[] {
  return chunks.map((chunk, index) => ({
    alias: `E${index + 1}`,
    chunkId: chunk.id,
    quote: chunk.content.replace(/\s+/g, ' ').trim().slice(0, 240),
    sourceKey: (chunk.source_url || chunk.source_title || chunk.id).trim().toLowerCase(),
    title: chunk.source_title || 'Untitled source',
    authors: chunk.authors ?? null,
    publisher: chunk.source_publisher ?? null,
    date: chunk.source_published_at ? String(chunk.source_published_at).slice(0, 10) : null,
    url: chunk.source_url ?? null,
    doi: chunk.doi ?? null,
    provider: chunk.provider ?? null,
  }));
}

export function sectionAliasContext(aliases: IssuedAlias[]): string {
  return aliases.map((alias) => `[${alias.alias}] quote: ${alias.quote}`).join('\n');
}

export function unknownAliases(text: string, aliases: IssuedAlias[]): string[] {
  const issued = new Set(aliases.map((alias) => alias.alias));
  return [...new Set([...text.matchAll(/\[(E\d+)\]/g)].map((match) => match[1]).filter((alias) => !issued.has(alias)))];
}

export function sourceTypeInWords(alias: IssuedAlias): string {
  const provider = (alias.provider ?? '').toLowerCase();
  if (provider.includes('arxiv')) return 'preprint';
  if (provider.includes('crossref') || provider.includes('pubmed')) return 'peer-reviewed study';
  return 'web page';
}

function siteName(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function formatReference(number: number, alias: IssuedAlias, style: string, accessed: string): string {
  const who = alias.authors || alias.publisher || siteName(alias.url);
  const link = alias.doi ? `https://doi.org/${alias.doi}` : alias.url;
  const type = sourceTypeInWords(alias);
  if (style === 'apa') {
    return [who, alias.date ? `(${alias.date})` : null, alias.title, type, link].filter(Boolean).join('. ');
  }
  const access = alias.doi ? '' : ` Accessed ${accessed}.`;
  return [`${number}.`, who, alias.title, alias.date, type + '.', access.trim(), link].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function renderReaderCitations(
  text: string,
  aliases: IssuedAlias[],
  style = 'numeric',
  accessed = '2 Oct 2026'
): { markdown: string; references: string; markers: Array<{ number: number; chunkId: string; alias: string }> } {
  const byAlias = new Map(aliases.map((alias) => [alias.alias, alias]));
  const order: IssuedAlias[] = [];
  const numberBySource = new Map<string, number>();
  const markers: Array<{ number: number; chunkId: string; alias: string }> = [];
  const markdown = text.replace(/\[(E\d+)\]/g, (full, alias: string) => {
    const issued = byAlias.get(alias);
    if (!issued || !issued.quote.trim()) return '';
    let number = numberBySource.get(issued.sourceKey);
    if (!number) {
      number = order.length + 1;
      numberBySource.set(issued.sourceKey, number);
      order.push(issued);
    }
    markers.push({ number, chunkId: issued.chunkId, alias });
    return `[${number}](#passage-${issued.chunkId})`;
  });
  const references = order.map((alias, index) => formatReference(index + 1, alias, style, accessed)).join('\n');
  return { markdown, references, markers };
}

export function citationRows(text: string, aliases: IssuedAlias[]): Array<{ alias: string; chunkId: string; quote: string; order: number }> {
  const rows: Array<{ alias: string; chunkId: string; quote: string; order: number }> = [];
  for (const match of text.matchAll(/\[(E\d+)\]/g)) {
    const issued = aliases.find((alias) => alias.alias === match[1]);
    if (!issued || !issued.quote.trim()) continue;
    rows.push({ alias: issued.alias, chunkId: issued.chunkId, quote: issued.quote, order: rows.length + 1 });
  }
  return rows;
}

/** Grant I. A switched-on non-adjudicative run records the count and does not fail on it. */
export function sourceCountSetsStatus(layer1: boolean, adjudicative: boolean): boolean {
  return !(layer1 && !adjudicative);
}

export function bindingFailed(text: string, aliases: IssuedAlias[]): boolean {
  return unknownAliases(text, aliases).length > 0 || [...text.matchAll(/\[(E\d+)\]/g)].some((match) => {
    const issued = aliases.find((alias) => alias.alias === match[1]);
    return !issued || !issued.quote.trim();
  });
}
