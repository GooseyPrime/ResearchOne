/**
 * How many sources a run is allowed to ingest.
 *
 * `MAX_EXTERNAL_INGEST_PER_RUN` defaults to 10. That was the whole explanation
 * for the operator's "why are there only 9 sources for a report this big?" —
 * the run asked for a long, detail-heavy report and was allowed ten sources to
 * build it from. Retrieval was not failing; the tap was set to ten.
 *
 * A flat cap cannot be right for both a one-paragraph lookup and a
 * seven-thousand-word portfolio of twenty opportunities. The cap now scales
 * with the size of what was actually asked for, with the configured value as
 * the FLOOR for an ordinary run rather than the answer for every run.
 *
 * It is still a cap. Every ingested source costs a fetch, an embedding and
 * storage, so the ceiling is deliberately finite and deliberately one constant
 * in one place.
 */

/** Roughly one source per this many words of requested report. */
const WORDS_PER_SOURCE = 350;

/** Extra sources beyond one per requested item, so items can be compared. */
const SOURCES_PER_REQUESTED_ITEM = 1;
const COMPARISON_HEADROOM = 5;

/** Hard ceiling. Cost and ingest latency, not epistemics. */
export const MAX_SOURCES_PER_RUN = 40;

export function resolveSourceIngestBudget(args: {
  /** The configured baseline, `config.discovery.maxIngestPerRun`. */
  configuredCap: number;
  /** Words the user asked the report to be, when they asked. */
  targetWordCount?: number | null;
  /** Items the deliverable must contain, e.g. "20 opportunities". */
  requestedArtifactCount?: number | null;
  /** An add-on that explicitly raises the cap still wins if it is higher. */
  addonCapOverride?: number | null;
}): number {
  const configured = Number.isFinite(args.configuredCap) && args.configuredCap > 0
    ? Math.floor(args.configuredCap)
    : 10;

  const byLength =
    typeof args.targetWordCount === 'number' && args.targetWordCount > 0
      ? Math.ceil(args.targetWordCount / WORDS_PER_SOURCE)
      : 0;

  const byItems =
    typeof args.requestedArtifactCount === 'number' && args.requestedArtifactCount > 0
      ? args.requestedArtifactCount * SOURCES_PER_REQUESTED_ITEM + COMPARISON_HEADROOM
      : 0;

  const addon =
    typeof args.addonCapOverride === 'number' && args.addonCapOverride > 0
      ? Math.floor(args.addonCapOverride)
      : 0;

  return Math.min(MAX_SOURCES_PER_RUN, Math.max(configured, byLength, byItems, addon));
}
/**
 * How many sources this run may actually ingest.
 *
 * The budget above is a FLOOR. Discovery used to compute
 * `min(planner's request, cap)`, so a planner asking for ten sources capped a
 * 7,000-word report at ten and the scaled budget changed nothing (Codex P1,
 * PR #229). The planner may ask for MORE, up to the hard ceiling; what it may
 * not do is ask for less than the deliverable needs.
 *
 * Lives here, next to the floor it enforces, rather than inline in the
 * orchestrator — a test of the arithmetic that re-implements the arithmetic
 * proves nothing.
 */
export function effectiveIngestCap(args: {
  budgetFloor: number;
  /** `max_sources_to_ingest` from the discovery plan; 0 or absent means none. */
  plannerRequest?: number | null;
}): number {
  const floor = Math.max(0, Math.floor(args.budgetFloor));
  const requested = Math.max(0, Math.floor(args.plannerRequest ?? 0));
  const ceiling = Math.max(floor, MAX_SOURCES_PER_RUN);
  return Math.min(Math.max(requested, floor), ceiling);
}
