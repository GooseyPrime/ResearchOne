/**
 * The exported report, as the reading page shows it (slice 5, item 7).
 *
 * PDF, Word and Markdown exports are made from one Markdown text. For a report
 * in the reader view that text is the section 2a report: its title once, its
 * sections, its numbered citations and its reference list, and nothing from the
 * never-list. Labels are already removed where the text is assembled; this
 * takes out what is left that a reader must not see.
 */
import { mapCitationProse } from './reportPresentation';

const norm = (text: string): string => text.replace(/[\s#*_]+/g, ' ').trim().toLowerCase();

/** A passage label from before citations were numbered: "[Chunk 3]", "(Chunks 3, 7)", "Chunk 12". An export cannot map it to a number, so it is taken out. */
const LEGACY_LABEL = /[[(]\s*chunks?\s+\d+(?:\s*(?:,|and|&)\s*\d+)*\s*[\])]|\bchunks?\s+\d+(?:\s*(?:,|and|&)\s*\d+)*\b/gi;

function withoutLegacyLabels(markdown: string): string {
  return mapCitationProse(markdown, (prose) =>
    prose
      .replace(LEGACY_LABEL, '')
      .replace(/\(\s*\)|\[\s*\]/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([.,;:])/g, '$1')
  );
}

/**
 * The export body for a reader-view report.
 *
 * A locked report stores its title as its first section, heading only. The
 * export already carries the title in its title block, so that heading would
 * print the title twice.
 */
export function readerExportBody(title: string | null, body: string): string {
  const wanted = norm(title ?? '');
  const blocks = body.split(/\n(?=## )/);
  const kept = blocks.filter((block) => {
    const [heading, ...rest] = block.split('\n');
    const isTitleOnly = wanted.length > 0 && heading.startsWith('## ') && norm(heading.slice(3)) === wanted && rest.join('\n').trim() === '';
    return !isTitleOnly;
  });
  return withoutLegacyLabels(kept.join('\n')).replace(/\n{3,}/g, '\n\n').trim();
}

/** True when the export text still has a reference list to stand behind its numbers. */
export function hasReferenceList(body: string): boolean {
  return /^## (References|Sources|Bibliography|Works cited)\s*$/im.test(body);
}
