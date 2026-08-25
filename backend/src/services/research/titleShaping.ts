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

  const shaped = trimTitle(stripHeadingDecoration(firstSentence(flattened)));
  return shaped || null;
}
