/** Flags later slices may turn on. Unset and unknown values are off. */
export const HARNESS_FLAG_NAMES = [
  'BASELINE_LAYER_ENABLED',
  'AUTHORITY_TIERS_ENABLED',
  'CITATION_LOCK_ENABLED',
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
    BASELINE_LAYER_ENABLED: false,
    AUTHORITY_TIERS_ENABLED: false,
    CITATION_LOCK_ENABLED: false,
    DOI_RESOLVE_ENABLED: false,
    PROVIDER_ROUTING_ENABLED: false,
    CHALLENGE_LEDGER_ENABLED: false,
    RESEARCH_TREE_ENABLED: false,
    OUTLINE_OPS_ENABLED: false,
    QUANT_CHECK_ENABLED: false,
  };
}

export function isHarnessFlagName(name: string): name is HarnessFlagName {
  return (HARNESS_FLAG_NAMES as readonly string[]).includes(name);
}
