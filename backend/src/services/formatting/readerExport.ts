/**
 * The exported report, as the reading page shows it (slice 5, item 7).
 *
 * PDF, Word and Markdown exports are made from one Markdown text. For a report
 * in the reader view that text is the section 2a report: its title once, its
 * sections, its numbered citations and its reference list, and nothing from the
 * never-list. Labels are already removed where the text is assembled; this
 * takes out what is left that a reader must not see.
 */
import { isOlderChallengeHeading, mapCitationProse, readerHeading, withoutRepeatedHeading } from './reportPresentation';

const norm = (text: string): string => text.replace(/[\s#*_]+/g, ' ').trim().toLowerCase();

/** A passage label from before citations were numbered: "[Chunk 3]", "(Chunks 3, 7)", "Chunk 12". */
const LEGACY_LABEL = /[[(]\s*chunks?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)\s*[\])]|\bchunks?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)\b/gi;

/**
 * Passage labels become the reader numbers the saved citations give them, the
 * same numbers the reading page shows. A label nothing maps is taken out.
 */
function withReaderNumbers(markdown: string, legacyNumbers: ReadonlyMap<number, number>): string {
  return mapCitationProse(markdown, (prose) =>
    prose
      .replace(LEGACY_LABEL, (_whole, bracketed: string | undefined, bare: string | undefined) => {
        const mapped = (bracketed ?? bare ?? '')
          .split(/\s*(?:,|and|&)\s*/)
          .map((label) => legacyNumbers.get(Number(label)))
          .filter((number): number is number => typeof number === 'number');
        return [...new Set(mapped)].map((number) => `[${number}]`).join('');
      })
      .replace(/\(\s*\)|\[\s*\]/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([.,;:])/g, '$1')
  );
}

/** A section the reading page shows on its Challenge tab, not in the report. The same rule as the page's. */
export function isChallengeSection(section: { title: string; section_type?: string | null }): boolean {
  return (
    section.section_type === 'challenge' ||
    /^(double-check\b|challenge\b|the challenge\b|adversarial (review|challenge)\b)/.test(norm(section.title)) ||
    // An older report's challenge sections, under the names the removed layout gave them.
    isOlderChallengeHeading(section.title)
  );
}

/** Whether the text still holds a passage label, so the mapping is only loaded for a report that needs it. */
export function hasLegacyLabels(body: string): boolean {
  let found = false;
  mapCitationProse(body, (prose) => {
    if (new RegExp(LEGACY_LABEL.source, 'i').test(prose)) found = true;
    return prose;
  });
  return found;
}

export interface ReaderExportOptions {
  /** Passage labels of an older report and the reader numbers they become. */
  legacyNumbers?: ReadonlyMap<number, number>;
  /** Titles of sections stored as the Challenge, whatever they are called. */
  challengeTitles?: readonly string[];
}

/**
 * The export body for a reader-view report: what the Report tab shows.
 *
 * A locked report stores its title as its first section, heading only. The
 * export already carries the title in its title block, so that heading would
 * print the title twice. The Challenge has its own tab on the page and is not
 * part of the report a reader exports.
 */
export function readerExportBody(title: string | null, body: string, options: ReaderExportOptions = {}): string {
  const wanted = norm(title ?? '');
  const challenge = new Set((options.challengeTitles ?? []).map(norm));
  const blocks = body.split(/\n(?=## )/);
  const kept = blocks.filter((block) => {
    const [heading, ...rest] = block.split('\n');
    if (!heading.startsWith('## ')) return true;
    const name = heading.slice(3);
    if (wanted.length > 0 && norm(name) === wanted && rest.join('\n').trim() === '') return false;
    return !(challenge.has(norm(name)) || isChallengeSection({ title: name }));
  });
  // An older report is exported under the headings the reading page shows for
  // it, and a heading its text repeats is printed once.
  const headed = kept.map((block) => {
    const [heading, ...rest] = block.split('\n');
    if (!heading.startsWith('## ')) return block;
    const name = heading.slice(3);
    const text = withoutRepeatedHeading(name, rest.join('\n'));
    // A removed line must not leave the text hard against its heading.
    return [`## ${readerHeading(name.trim())}`, text === rest.join('\n') ? text : `\n${text}`].join('\n');
  });
  return withReaderNumbers(headed.join('\n'), options.legacyNumbers ?? new Map()).replace(/\n{3,}/g, '\n\n').trim();
}

/** True when the export text still has a reference list to stand behind its numbers. */
export function hasReferenceList(body: string): boolean {
  return /^## (References|Sources|Bibliography|Works cited)\s*$/im.test(body);
}
