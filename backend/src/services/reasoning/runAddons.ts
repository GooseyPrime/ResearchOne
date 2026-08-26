import { queryOne } from '../../db/pool';

export const RUN_ADDON_KEYS = [
  'parallel_search',
  'parallel_extract',
  'smart_citations',
] as const;

export type RunAddonKey = (typeof RUN_ADDON_KEYS)[number];

export function normalizeRunAddonKeys(raw: unknown): RunAddonKey[] {
  if (!Array.isArray(raw)) return [];
  const out: RunAddonKey[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (RUN_ADDON_KEYS.includes(item as RunAddonKey) && !out.includes(item as RunAddonKey)) {
      out.push(item as RunAddonKey);
    }
  }
  return out;
}

export function hasRunAddon(addons: readonly string[], key: RunAddonKey): boolean {
  return addons.includes(key);
}

/** Read persisted add-ons for a run; deploy-skew safe when column missing. */
export type RunAddonPipelineEffects = {
  retrievalTopK: number;
  citationChunkContextLimit: number;
  maxIngestCapOverride?: number;
};

/** Maps persisted/job add-on keys to pipeline tuning (charge-without-effect guard). */
export function buildRunAddonPipelineEffects(addons: readonly RunAddonKey[]): RunAddonPipelineEffects {
  return {
    retrievalTopK: hasRunAddon(addons, 'parallel_extract') ? 25 : 15,
    citationChunkContextLimit: hasRunAddon(addons, 'smart_citations') ? 40 : 20,
    maxIngestCapOverride: hasRunAddon(addons, 'parallel_search') ? 17 : undefined,
  };
}

/*
 * `applyAdversarialTwinToSkepticMode` was removed in WO-AH along with the
 * add-on it existed for. It un-skipped the challenge stage and forced the
 * strongest challenge mode; every run now runs the challenge pass, and how
 * strong it is is decided by the planner from the request rather than bought.
 */
/**
 * The removed add-on's key, kept for runs that were already paid for.
 *
 * A run queued before this deploy with "Devil's Advocate Review" selected
 * carries a wallet hold that includes the $5 surcharge. `normalizeRunAddonKeys`
 * drops the key as unknown, so the run would complete, the orchestrator would
 * consume the hold, and the customer would have paid five dollars for a
 * stronger pass that never ran (Codex P1, PR #229).
 *
 * Rather than unpick the billing, the run gets what it bought: its challenge
 * pass is forced to the strongest setting. Delete this once no queued or
 * plan-pending run created before the WO-AH deploy remains — it is dead the
 * moment the last of them finishes, and it is doing nothing for every run
 * created since.
 */
export const LEGACY_PAID_CHALLENGE_UPGRADE_KEY = 'adversarial_twin';

/**
 * Did this run pay for the stronger challenge pass under the old add-on?
 *
 * Reads the RAW values, deliberately: `normalizeRunAddonKeys` filters the key
 * out, which is exactly why the paid upgrade went missing.
 */
export function paidForLegacyChallengeUpgrade(raw: unknown): boolean {
  return Array.isArray(raw) && raw.some((item) => item === LEGACY_PAID_CHALLENGE_UPGRADE_KEY);
}

/** Force the strongest challenge pass on a profile, leaving everything else. */
export function applyLegacyPaidChallengeUpgrade<T extends { skepticMode: 'gate' | 'annotate' }>(
  profile: T
): T {
  return profile.skepticMode === 'gate' ? profile : { ...profile, skepticMode: 'gate' as const };
}

/** Raw persisted add-ons for a run, unfiltered. Deploy-skew safe. */
export async function readRawRunAddons(runId: string, jobAddons?: unknown): Promise<unknown> {
  if (Array.isArray(jobAddons) && jobAddons.length > 0) return jobAddons;
  try {
    const row = await queryOne<{ selected_addons: unknown }>(
      `SELECT selected_addons FROM research_runs WHERE id = $1`,
      [runId]
    );
    return row?.selected_addons ?? null;
  } catch {
    return null;
  }
}

export async function resolveRunAddons(runId: string, jobAddons?: string[]): Promise<RunAddonKey[]> {
  const fromJob = normalizeRunAddonKeys(jobAddons);
  if (fromJob.length > 0) return fromJob;

  try {
    const row = await queryOne<{ selected_addons: unknown }>(
      `SELECT selected_addons FROM research_runs WHERE id = $1`,
      [runId]
    );
    if (!row) return [];
    return normalizeRunAddonKeys(row.selected_addons);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === '42703') return fromJob;
    throw err;
  }
}
