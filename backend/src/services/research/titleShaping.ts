/**
 * Shaping for human-facing titles derived from model output.
 *
 * Extracted from `reportGenerator` because there are now TWO derivations that
 * must agree on what a title looks like: the generated REPORT title
 * (`deriveGeneratedReportTitle`, still in reportGenerator) and the RUN display
 * title (`deriveRunDisplayTitle`, below). Two copies of the length cap or of
 * the decoration stripper would drift, and a run whose title changed shape the
 * moment its report finalised would read as a bug.
 *
 * Everything above `deriveRunDisplayTitle` was MOVED here verbatim rather than
 * retyped (Rule 44 T7). `reportGenerator` imports it back and re-exports
 * `stripHeadingDecoration`, so its existing consumers are unaffected.
 */

export const GENERATED_TITLE_MAX_LENGTH = 120;

/**
 * Wrappers a model puts around a heading it is emphasising or quoting.
 * Ordered longest-first so `***x***` is not mistaken for `*` + `**x**` + `*`.
 */
const HEADING_WRAPPERS: ReadonlyArray<readonly [string, string]> = [
  ['***', '***'],
  ['**', '**'],
  ['*', '*'],
  ['___', '___'],
  ['__', '__'],
  ['_', '_'],
  ['~~', '~~'],
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['«', '»'],
];

/**
 * Remove emphasis, quoting and trailing punctuation from a heading.
 *
 * `looksLikeStructuralLabel` anchors its pattern to the whole candidate, so
 * `# **Overview**`, `` # `Recommendation` `` and `# "Findings"` all slipped
 * past it and were stored as report titles verbatim, Markdown included
 * (Codex, #224 second pass).
 *
 * Only *balanced* decoration is peeled, and only when the delimiter does not
 * recur inside. `*Nature* on CRISPR` and `**A** vs **B**` are left alone —
 * those are emphasised spans within a title, not a wrapped title.
 */
export function stripHeadingDecoration(candidate: string): string {
  let text = candidate.trim();

  for (let guard = 0; guard < 8; guard += 1) {
    const before = text;

    // A balanced backtick run of any length: `x`, ``x``, ```x```.
    const fenced = text.match(/^(`+)([\s\S]+)\1$/);
    if (fenced?.[2] && !fenced[2].includes('`')) {
      text = fenced[2].trim();
      continue;
    }

    for (const [open, close] of HEADING_WRAPPERS) {
      if (text.length <= open.length + close.length) continue;
      if (!text.startsWith(open) || !text.endsWith(close)) continue;
      const inner = text.slice(open.length, text.length - close.length).trim();
      // A recurring delimiter means these are two spans, not one wrapper.
      if (!inner || inner.includes(open) || inner.includes(close)) continue;
      text = inner;
      break;
    }
    if (text !== before) continue;

    const detrailed = text.replace(/[\s:;,.]+$/, '');
    if (detrailed && detrailed !== text) {
      text = detrailed;
      continue;
    }

    break;
  }

  return text || candidate.trim();
}

/**
 * Names of sections, which are never the title of a report (RJ-018). Older
 * reports were stored under one ("Primary Evidence") and shown under it.
 *
 * The first pattern is the list `reportGenerator.looksLikeStructuralLabel`
 * uses when it picks a title for a NEW report; it is repeated here because this
 * module is kept free of the generator's imports. `rj018Titles.test.ts` fails
 * if a name the generator refuses is accepted here.
 */
const STRUCTURAL_LABEL_PATTERN =
  /^(dimensions?\s*table|comparison\s*table|ranking\s*table|summary\s*table|data\s*table|recommendation|overview|introduction|findings|analysis|conclusion|results|executive\s*summary|methodology|background|appendix|references|bibliography)$/i;
/** Section names of the layout that was removed, and the headings a reader is shown in their place. */
const RETIRED_SECTION_LABEL_PATTERN = new RegExp(
  `^(${[
    'fram' + 'ing',
    'primary\\s*evidence',
    'evidence\\s*ledger',
    'contested\\s*zones?',
    'contradiction\\s*analysis',
    'unresolved(?:\\s*questions)?',
    'recommended\\s*next\\s*queries',
    'research\\s*question(?:\\s*and\\s*scope)?',
    'challenges(?:\\s*and\\s*alternative\\s*explanations)?',
    'falsification\\s*criteria',
    // The headings a reader is shown in their place are section names too.
    'summary',
    'key\\s*findings',
    'what\\s*was\\s*asked',
    'what\\s*the\\s*sources\\s*show',
    'where\\s*sources\\s*disagree',
    'open\\s*questions',
    'further\\s*questions',
    'other\\s*explanations',
    'limits\\s*of\\s*this\\s*report',
    'about\\s*this\\s*report',
    'report',
  ].join('|')})$`,
  'i'
);

export function isSectionNameTitle(candidate: string): boolean {
  const value = candidate.trim();
  return STRUCTURAL_LABEL_PATTERN.test(value) || RETIRED_SECTION_LABEL_PATTERN.test(value);
}

export function trimTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= GENERATED_TITLE_MAX_LENGTH) return normalized;
  return normalized.slice(0, GENERATED_TITLE_MAX_LENGTH - 1).trimEnd() + '…';
}

/**
 * Abbreviations whose trailing period does not end a sentence.
 *
 * A closed, deliberately-enumerated set rather than a pattern, because there is
 * no shape that distinguishes "vs." from "regimes." — only the word does.
 */
const SENTENCE_ABBREVIATIONS: ReadonlySet<string> = new Set([
  'vs', 'etc', 'eg', 'ie', 'cf', 'al', 'approx', 'ca', 'viz', 'est',
  'no', 'nos', 'pp', 'fig', 'figs', 'ch', 'sec', 'art', 'ed', 'eds', 'vol',
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'inc', 'ltd', 'co', 'corp', 'jr', 'sr',
]);

/**
 * The first sentence of `text`, or all of it when there is only one.
 *
 * The property, stated plainly: *where does the first sentence end?* That is a
 * question about meaning, so every implementation is a proxy and the honest
 * thing is to name which real inputs the proxy gets wrong (Rule 44 T2).
 *
 * The proxy: a boundary is `.`/`!`/`?` followed by whitespace. `!` and `?` are
 * taken as-is. A `.` is rejected when the word before it is a single character
 * (an initialism — `U.S.`, `E.U.`) or a listed abbreviation (`vs.`, `etc.`).
 *
 * Known wrong, and accepted: a sentence whose final word is one character or a
 * digit ("Consider option A. Then…") is not split, and an abbreviation outside
 * the set above splits early. Both fail toward keeping MORE of the summary,
 * which `trimTitle` then caps — the safe direction, since the failure is a
 * slightly long title rather than a truncated one.
 *
 * Deliberately NOT script-gated. The first version required the character after
 * the boundary to match `[^a-z]`, which is the `split(/[^a-z0-9]+/)` mistake
 * from #221 wearing a different hat: it decides sentence structure from Latin
 * letter case and has no meaning at all for Chinese, Japanese, Arabic or
 * Cyrillic text. It also passed its own tests, because both abbreviation
 * fixtures happened to be followed by a lowercase word — a verification shaped
 * like the implementation (Rule 44 T1). `vs. Mexico` is what caught it.
 */
function firstSentence(text: string): string {
  for (const match of text.matchAll(/([.!?])\s+(?=\S)/gu)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    if (match[1] !== '.') return text.slice(0, index + 1);

    const before = text.slice(0, index);
    const lastWord = before.match(/[\p{L}\p{N}]+$/u)?.[0] ?? '';
    if (lastWord.length <= 1) continue;
    if (SENTENCE_ABBREVIATIONS.has(lastWord.toLowerCase())) continue;

    return `${before}.`;
  }
  return text;
}

/**
 * Title for an in-flight run, from the plan the planner already produced.
 *
 * `research_runs.title` is the raw prompt truncated to 200 characters
 * (`api/routes/research.ts`), so it is not usable as a name. The planner's
 * `topicAnalysis.summary` is a sentence about the subject, and it is the
 * closest thing to a title that exists before a report does.
 *
 * Two honest outcomes only — a shaped title, or `null`. It never hands the
 * input back for the caller to deal with; that third outcome is what left the
 * `splitCredentials` sanitizer only *usually* sanitizing (Rule 44 T9, #224).
 * A caller receiving `null` falls back to the report title, then `run_ref`.
 */
export function deriveRunDisplayTitle(summary: string | null | undefined): string | null {
  if (typeof summary !== 'string') return null;

  const flattened = summary.replace(/\s+/g, ' ').trim();
  if (!flattened) return null;

  // Strip the wrappers BEFORE looking for a sentence boundary.
  //
  // This ran `firstSentence` first, so a summary wrapped in emphasis or quotes
  // — `**Compares EU and US pathways. Both are contested.**` — had its boundary
  // search performed against a string whose first sentence still carried an
  // opening `**`, and the closing wrapper was then orphaned on a fragment that
  // no longer ended the string. Decoration has to come off before the text is
  // cut, not after (Codex, post-merge review of #227).
  const undecorated = stripHeadingDecoration(flattened);
  const shaped = trimTitle(stripHeadingDecoration(firstSentence(undecorated)));
  return shaped || null;
}

/** A heading that names a part of a written request, not its subject. */
const REQUEST_PART_HEADING =
  /^(?:research\s+)?(?:objectives?|context|task|request|question|topic|background|overview|instructions?|prompt|goals?|scope|intent|brief|summary|introduction|purpose|problem(?:\s+statement)?)$/i;
/** The same words opening a sentence as a label: "Context: Do a full review…". */
const REQUEST_PART_LABEL =
  /^(?:research\s+)?(?:objectives?|context|task|request|question|topic|background|overview|instructions?|prompt|goals?|scope|intent|brief|purpose)\s*[:–—-]\s*/i;
const REQUEST_TITLE_MIN_CHARS = 12;

/**
 * A short title made from the request itself (RJ-018): its opening heading or
 * first sentence, without Markdown, cut to title length. Used wherever no plain
 * title exists. A heading that only names a part of the request ("Research
 * Objective", "Context") is passed over for the sentence under it. `null` when
 * the request is empty.
 *
 * The page makes the same title the same way (`titleFromRequest` in
 * `frontend/src/utils/plainTitles.ts`); one list of cases,
 * `__tests__/fixtures/reportLabelCases.json`, is read by both tests.
 */
export function titleFromRequest(request: string | null | undefined): string | null {
  if (typeof request !== 'string') return null;
  const text = request.trim();
  if (!text) return null;
  const clean = (value: string): string => value.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
  const headingMatch = text.slice(0, 400).match(/^#{1,3}\s+(.+?)\s*$/m);
  const heading = headingMatch?.[1] ? clean(headingMatch[1]).replace(/[\s:;,.]+$/, '') : '';
  const usableHeading = heading.length >= REQUEST_TITLE_MIN_CHARS && !REQUEST_PART_HEADING.test(heading) ? heading : '';
  const sentence =
    text
      .replace(/^#{1,6}\s+.*$/gm, '')
      .split(/(?<=[.?!])\s+|\n{2,}/)
      .map((part) => clean(part).replace(REQUEST_PART_LABEL, '').replace(/^[-\s]+/, ''))
      .find((part) => part.length >= REQUEST_TITLE_MIN_CHARS) ?? '';
  const line = (usableHeading || sentence || heading).replace(/[\s:;,.]+$/, '');
  if (!line) return null;
  return line.length > GENERATED_TITLE_MAX_LENGTH ? `${line.slice(0, GENERATED_TITLE_MAX_LENGTH - 1).trimEnd()}…` : line;
}

/**
 * Whether a stored title is the planning step talking about the request rather
 * than a title of it: "The query requires investigating dual dimensions: (1)
 * concrete security measures…". Such a sentence was stored as the run's title
 * until RJ-018, and is still stored on older runs.
 *
 * Two signs, either of which is enough: it opens by saying what the request
 * does ("The query requires…", "This request asks…", "The user wants…"; a
 * title such as "The question of Scottish independence" has no such verb and
 * is kept), or it is a long
 * sentence that enumerates ("(1) … (2) …") or describes what must be done
 * ("requires investigating", "needs to examine").
 */
const ANALYSIS_OPENING =
  /^(?:the|this)\s+(?:user(?:'s|’s)?\s+)?(?:(?:research\s+)?(?:query|request|question|prompt|task)|user)\s+(?:itself\s+|here\s+|essentially\s+|primarily\s+)?(?:requires?|involves?|entails?|necessitates?|asks?|is|seeks?|spans?|needs?|concerns?|has|cent(?:er|re)s|focus(?:es)?|covers?|wants?|calls)\b/i;
const ANALYSIS_VERB =
  /\b(?:requires?|involves?|entails?|necessitates?|calls\s+for|needs?\s+to|seeks?\s+to|asks?\s+(?:for|about|whether|how|what)|spans?|is\s+asking)\b/i;
const ANALYSIS_ENUMERATION = /\(\s*1\s*\)|\b1\)\s|\bdual\s+dimensions?\b|\bmulti[- ]?(?:layer|dimension)/i;
const PLAIN_TITLE_MAX_CHARS = 90;

export function looksLikePlanningAnalysis(title: string | null | undefined): boolean {
  if (typeof title !== 'string') return false;
  const text = title.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (ANALYSIS_OPENING.test(text)) return true;
  return text.length > PLAIN_TITLE_MAX_CHARS && (ANALYSIS_ENUMERATION.test(text) || ANALYSIS_VERB.test(text));
}

/**
 * The title a customer sees for a run (RJ-018).
 *
 * In order: the short plain title the planning step was asked to write, when it
 * is one; otherwise a title made from the request. Never the planning step's
 * own analysis of the request, and never an old section name.
 */
export function plainRunTitle(planTitle: string | null | undefined, request: string | null | undefined): string | null {
  if (typeof planTitle === 'string') {
    const shaped = trimTitle(stripHeadingDecoration(planTitle.replace(/\s+/g, ' ').trim()));
    if (shaped && shaped.length <= PLAIN_TITLE_MAX_CHARS && !looksLikePlanningAnalysis(shaped) && !isSectionNameTitle(shaped)) {
      return shaped;
    }
  }
  return titleFromRequest(request);
}

/**
 * The title a reader sees for a report (RJ-018). A report stored under an old
 * section name ("Primary Evidence", "Contested Zones") or under no title is
 * shown under a title made from the request it answers. A real title is
 * returned as stored.
 */
export function readerReportTitle(title: string | null | undefined, request: string | null | undefined): string | null {
  const stored = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
  if (stored && !isSectionNameTitle(stripHeadingDecoration(stored))) return stored;
  return titleFromRequest(request) ?? (stored || null);
}
