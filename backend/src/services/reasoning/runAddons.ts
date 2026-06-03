import { queryOne } from '../../db/pool';
import {
  PIPELINE_STAGES,
  type OrchestrationProfileDefinition,
  type PipelineStage,
} from '../planning/orchestrationProfiles';

export const RUN_ADDON_KEYS = [
  'adversarial_twin',
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

/**
 * Devil's Advocate add-on: un-skip challenge and enable skeptic gate so the paid pass runs.
 */
export function applyAdversarialTwinToSkepticMode(
  profile: OrchestrationProfileDefinition,
  addons: readonly RunAddonKey[]
): OrchestrationProfileDefinition {
  if (!hasRunAddon(addons, 'adversarial_twin')) return profile;

  const skipSet = new Set<PipelineStage>(
    profile.agentsToSkip.filter((s): s is PipelineStage => s !== 'challenge')
  );
  const agentsToSkip = PIPELINE_STAGES.filter((s) => skipSet.has(s));
  const agentsToRun = PIPELINE_STAGES.filter((s) => !skipSet.has(s));
  const skepticMode = profile.skepticMode === 'off' ? 'gate' : profile.skepticMode;

  return { ...profile, agentsToSkip, agentsToRun, skepticMode };
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
