import type { PerRunModelOverrides } from '../runtimeModelStore';

/** Per-role fallback opt-in from validated `model_overrides` payload. */
export function allowFallbackByRoleFromOverrides(overrides: PerRunModelOverrides): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [role, entry] of Object.entries(overrides.overrides ?? {})) {
    if (entry?.fallbackEnabled === true) out[role] = true;
  }
  return out;
}

/**
 * Reconstruct per-role fallback flags from `model_ensemble` snapshot on `research_runs`
 * (written at run start; includes `fallback_enabled` per role).
 */
export function allowFallbackByRoleFromModelEnsembleSnapshot(snapshot: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!snapshot || typeof snapshot !== 'object') return out;
  for (const [role, val] of Object.entries(snapshot as Record<string, unknown>)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const o = val as { fallback_enabled?: unknown };
      if (o.fallback_enabled === true) out[role] = true;
    }
  }
  return out;
}
