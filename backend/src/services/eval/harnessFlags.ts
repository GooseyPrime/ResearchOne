/**
 * Flags a run may record. The three finished features (authority tiers, DOI
 * resolution, provider routing) are on by default since 14 Oct 2026, as they
 * are in production; the flags of unbuilt slices are off. Unknown names are off.
 *
 * The report layout has no flag: BASELINE_LAYER_ENABLED, CITATION_LOCK_ENABLED
 * and READER_VIEW_ENABLED were removed on 8 Oct 2026, and a value recorded under
 * one of those names is not read by anything.
 */
export const HARNESS_FLAG_NAMES = [
  'AUTHORITY_TIERS_ENABLED',
  'DOI_RESOLVE_ENABLED',
  'PROVIDER_ROUTING_ENABLED',
  'CHALLENGE_LEDGER_ENABLED',
  'RESEARCH_TREE_ENABLED',
  'OUTLINE_OPS_ENABLED',
  'QUANT_CHECK_ENABLED',
] as const;

export type HarnessFlagName = (typeof HARNESS_FLAG_NAMES)[number];

export function harnessFlagDefaults(): Record<HarnessFlagName, boolean> {
  return {
    AUTHORITY_TIERS_ENABLED: true,
    DOI_RESOLVE_ENABLED: true,
    PROVIDER_ROUTING_ENABLED: true,
    CHALLENGE_LEDGER_ENABLED: false,
    RESEARCH_TREE_ENABLED: false,
    OUTLINE_OPS_ENABLED: false,
    QUANT_CHECK_ENABLED: false,
  };
}

export function isHarnessFlagName(name: string): name is HarnessFlagName {
  return (HARNESS_FLAG_NAMES as readonly string[]).includes(name);
}

/**
 * Names that used to switch the report layout. A request that still carries one
 * is not refused; the name is dropped before anything is recorded, so neither
 * `true` nor `false` under it reaches a run.
 */
export const RETIRED_FLAG_NAMES: readonly string[] = ['BASELINE_LAYER_ENABLED', 'CITATION_LOCK_ENABLED', 'READER_VIEW_ENABLED'];
