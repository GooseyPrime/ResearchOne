/**
 * The one place a run's human-facing name is resolved.
 *
 * `research_runs.title` is NOT a name: `api/routes/research.ts` sets it to the
 * raw prompt truncated to 200 characters. Every surface that reached for it
 * therefore rendered the prompt — the live run page as a bold `<h1>`, the
 * dossier cards as headlines carrying Markdown `#`. `title` appears nowhere in
 * this module, deliberately, and `query` is only ever shortened into a title.
 *
 * The chain, in order:
 *
 *   1. `display_title`  — written server-side at the plan gate (migration 057):
 *                         the short plain title the planning step writes.
 *   2. `report_title`   — present on `v_dossier` for a run that produced a
 *                         report. Covers historical runs, whose `display_title`
 *                         is NULL because 057 deliberately does not backfill.
 *   3. the request      — a SHORT title made from it (its opening heading or
 *                         first sentence, cut to title length), RJ-018. Not the
 *                         request itself, which is what this module exists to
 *                         keep out of headings.
 *   4. `run_ref`        — `R1-YYYYMMDD-HHMM-XXXXX-C`, assigned to EVERY run
 *                         including failures, and already the value a user
 *                         quotes to support.
 *   5. a generic label  — only when a deployment predates migration 055 too.
 *
 * Steps 1 and 2 are skipped when the stored value is not a title: the planning
 * step's sentence about the request ("The query requires investigating…") or
 * the name of an old report section.
 *
 * `display_title` outranks `report_title` on purpose: it is written once, at
 * plan time, so a run's name does not change the moment its report finalises.
 * A name that shifts under the reader reads as a bug even when both values are
 * individually correct.
 */

import { isSectionNameTitle, looksLikePlanningAnalysis, titleFromRequest } from './plainTitles';

export interface RunTitleSource {
  /** `research_runs.display_title` (migration 057). */
  display_title?: string | null;
  /** `v_dossier.report_title`, where the surface has it. */
  report_title?: string | null;
  /** `research_runs.run_ref` (migration 055). */
  run_ref?: string | null;
  /**
   * The request as the person wrote it (`research_runs.query`). Never shown as
   * the title; a SHORT title is made from it when no plain title exists.
   */
  query?: string | null;
}

/** Fallback of last resort. Never a truncated prompt. */
export const UNTITLED_RUN_LABEL = 'Research run';

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * A stored title that is a title. Two stored values are not (RJ-018): the
 * planning step's own sentence about the request, which older runs carry as
 * their `display_title`, and the name of an old report section, which older
 * reports carry as their title.
 */
function plain(value: string | null | undefined): string | null {
  const text = firstNonEmpty(value);
  if (!text || looksLikePlanningAnalysis(text) || isSectionNameTitle(text)) return null;
  return text;
}

/** The run's name where one exists: a plain stored title, or a short title made from the request. */
function nameOf(run: RunTitleSource): string | null {
  return plain(run.display_title) ?? plain(run.report_title) ?? titleFromRequest(run.query);
}

export function runDisplayTitle(run: RunTitleSource | null | undefined): string {
  if (!run) return UNTITLED_RUN_LABEL;
  return nameOf(run) ?? firstNonEmpty(run.run_ref) ?? UNTITLED_RUN_LABEL;
}

/**
 * True when the resolved title is the reference rather than a real name.
 *
 * Surfaces render a reference in monospace and a name in prose, and asking the
 * caller to re-derive which one it got would put the chain in two places.
 */
export function isReferenceTitle(run: RunTitleSource | null | undefined): boolean {
  if (!run) return true;
  return nameOf(run) === null;
}
