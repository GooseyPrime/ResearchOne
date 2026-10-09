/**
 * What may and may not stand as a title a customer reads (RJ-018).
 *
 * Two things were shown as titles that are not titles: the name of an old
 * report section ("Primary Evidence"), which older reports were stored under,
 * and the planning step's own sentence about the request ("The query requires
 * investigating dual dimensions: (1) …"), which older runs were stored under.
 * The server now sends neither; these are the same rules on the page, so a
 * page that is newer than the server it talks to shows neither as well.
 */

const norm = (text: string): string => text.replace(/[\s#*_`"'“”]+/g, ' ').trim().replace(/[:.;,]+$/, '').trim().toLowerCase();

/** Names of sections, old and new. None of them is the title of a report. */
const SECTION_NAME = new RegExp(
  `^(?:${[
    'fram' + 'ing',
    'primary evidence',
    'evidence ledger',
    'contested zones?',
    'contradiction analysis',
    'unresolved(?: questions)?',
    'recommended next queries',
    'research question(?: and scope)?',
    'challenges(?: and alternative explanations)?',
    'falsification criteria',
    'executive summary',
    'summary',
    'key findings',
    'background',
    'overview',
    'introduction',
    'findings',
    'analysis',
    'conclusion',
    'results',
    'methodology',
    'references',
    'what was asked',
    'what the sources show',
    'where sources disagree',
    'open questions',
    'further questions',
    'other explanations',
    'limits of this report',
    'about this report',
    'report',
  ].join('|')})$`
);

export function isSectionNameTitle(title: string | null | undefined): boolean {
  return typeof title === 'string' && SECTION_NAME.test(norm(title));
}

const ANALYSIS_OPENING =
  /^(?:the|this)\s+(?:user(?:'s|’s)?\s+)?(?:(?:research\s+)?(?:query|request|question|prompt|task)|user)\s+(?:itself\s+|here\s+|essentially\s+|primarily\s+)?(?:requires?|involves?|entails?|necessitates?|asks?|is|seeks?|spans?|needs?|concerns?|has|cent(?:er|re)s|focus(?:es)?|covers?|wants?|calls)\b/i;
const ANALYSIS_VERB =
  /\b(?:requires?|involves?|entails?|necessitates?|calls\s+for|needs?\s+to|seeks?\s+to|asks?\s+(?:for|about|whether|how|what)|spans?|is\s+asking)\b/i;
const ANALYSIS_ENUMERATION = /\(\s*1\s*\)|\b1\)\s|\bdual\s+dimensions?\b|\bmulti[- ]?(?:layer|dimension)/i;
const PLAIN_TITLE_MAX_CHARS = 90;

/** The planning step talking about the request, rather than a title of it. */
export function looksLikePlanningAnalysis(title: string | null | undefined): boolean {
  if (typeof title !== 'string') return false;
  const text = title.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (ANALYSIS_OPENING.test(text)) return true;
  return text.length > PLAIN_TITLE_MAX_CHARS && (ANALYSIS_ENUMERATION.test(text) || ANALYSIS_VERB.test(text));
}

const TITLE_MAX_CHARS = 120;
const MIN_TITLE_CHARS = 12;
/** A heading that names a part of a written request, not its subject. */
const REQUEST_PART_HEADING =
  /^(?:research\s+)?(?:objectives?|context|task|request|question|topic|background|overview|instructions?|prompt|goals?|scope|intent|brief|summary|introduction|purpose|problem(?:\s+statement)?)$/i;
/** The same words opening a sentence as a label: "Context: Do a full review…". */
const REQUEST_PART_LABEL =
  /^(?:research\s+)?(?:objectives?|context|task|request|question|topic|background|overview|instructions?|prompt|goals?|scope|intent|brief|purpose)\s*[:–—-]\s*/i;

/**
 * A short title made from the request: its opening heading or first sentence,
 * without Markdown, cut to title length. Never the whole request. A heading
 * that only names a part of the request ("Research Objective", "Context") is
 * passed over for the sentence under it. `null` when there is no request.
 *
 * The server makes the same title the same way (`titleFromRequest` in
 * `backend/src/services/research/titleShaping.ts`); one list of cases,
 * `backend/src/__tests__/fixtures/reportLabelCases.json`, is read by both tests.
 */
export function titleFromRequest(request: string | null | undefined): string | null {
  if (typeof request !== 'string') return null;
  const text = request.trim();
  if (!text) return null;
  // Markdown is taken off where it is Markdown: a heading's hashes, and emphasis
  // or code marks that wrap a span. A character that is part of the subject
  // ("C#", "foo_bar", "2 * 3") is kept.
  const clean = (value: string): string =>
    value
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/(\*\*\*|\*\*|___|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
      .replace(/(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  // Only a heading that opens the request names it. A heading further down
  // ("## Output requirements") names a part of the request, not its subject.
  const firstLine = text.split('\n').find((line) => line.trim().length > 0) ?? '';
  const headingMatch = /^\s{0,3}#{1,3}\s+(.+?)\s*$/.exec(firstLine);
  const heading = headingMatch?.[1] ? clean(headingMatch[1]).replace(/[\s:;,.]+$/, '') : '';
  const usableHeading = heading.length >= MIN_TITLE_CHARS && !REQUEST_PART_HEADING.test(heading) ? heading : '';
  const sentence = text
    .replace(/^#{1,6}\s+.*$/gm, '')
    .split(/(?<=[.?!])\s+|\n{2,}/)
    .map((part) => clean(part).replace(REQUEST_PART_LABEL, '').replace(/^[-\s]+/, ''))
    .find((part) => part.length >= MIN_TITLE_CHARS) ?? '';
  const line = (usableHeading || sentence || heading).replace(/[\s:;,.]+$/, '');
  if (!line) return null;
  return line.length > TITLE_MAX_CHARS ? `${line.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…` : line;
}

/** A report's title as a reader sees it: its real title, or a title of the request it answers. */
export function reportDisplayTitle(title: string | null | undefined, request: string | null | undefined): string {
  const stored = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
  if (stored && !isSectionNameTitle(stored)) return stored;
  return titleFromRequest(request) ?? stored;
}
