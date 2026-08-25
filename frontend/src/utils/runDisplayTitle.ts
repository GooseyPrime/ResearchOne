/**
 * The one place a run's human-facing name is resolved.
 *
 * `research_runs.title` is NOT a name: `api/routes/research.ts` sets it to the
 * raw prompt truncated to 200 characters. Every surface that reached for it
 * therefore rendered the prompt — the live run page as a bold `<h1>`, the
 * dossier cards as headlines carrying Markdown `#`. Neither `title` nor `query`
 * appears anywhere in this module, deliberately.
 *
 * The chain, in order:
 *
 *   1. `display_title`  — written server-side at the plan gate (migration 057).
 *   2. `report_title`   — present on `v_dossier` for a run that produced a
 *                         report. Covers historical runs, whose `display_title`
 *                         is NULL because 057 deliberately does not backfill.
 *   3. `run_ref`        — `R1-YYYYMMDD-HHMM-XXXXX-C`, assigned to EVERY run
 *                         including failures, and already the value a user
 *                         quotes to support.
 *   4. a generic label  — only when a deployment predates migration 055 too.
 *
 * `display_title` outranks `report_title` on purpose: it is written once, at
 * plan time, so a run's name does not change the moment its report finalises.
 * A name that shifts under the reader reads as a bug even when both values are
 * individually correct.
 */

export interface RunTitleSource {
  /** `research_runs.display_title` (migration 057). */
  display_title?: string | null;
  /** `v_dossier.report_title`, where the surface has it. */
  report_title?: string | null;
  /** `research_runs.run_ref` (migration 055). */
  run_ref?: string | null;
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

export function runDisplayTitle(run: RunTitleSource | null | undefined): string {
  if (!run) return UNTITLED_RUN_LABEL;
  return (
    firstNonEmpty(run.display_title, run.report_title, run.run_ref) ?? UNTITLED_RUN_LABEL
  );
}

/**
 * True when the resolved title is the reference rather than a real name.
 *
 * Surfaces render a reference in monospace and a name in prose, and asking the
 * caller to re-derive which one it got would put the chain in two places.
 */
export function isReferenceTitle(run: RunTitleSource | null | undefined): boolean {
  if (!run) return true;
  return firstNonEmpty(run.display_title, run.report_title) === null;
}
