import { query, queryOne } from '../db/pool';
import { logger } from '../utils/logger';
import type { ModelRole } from './openrouter/openrouterService';
import type { ReasoningModelRole } from './reasoning/reasoningModelPolicy';
import { APPROVED_REASONING_MODEL_ALLOWLIST } from './reasoning/reasoningModelPolicy';

/** Embedding models allowed for runtime override (OpenRouter-style ids). */
const APPROVED_EMBEDDING_MODELS = new Set([
  'openai/text-embedding-3-small',
  'openai/text-embedding-3-large',
  'openai/text-embedding-ada-002',
]);

export type ModelOverrideEntry = { primary?: string; fallback?: string };

export type RuntimeOverridesPayload = {
  overrides: Record<string, ModelOverrideEntry>;
  embedding?: string;
};

export type PerRunModelOverrides = RuntimeOverridesPayload;

let cached: RuntimeOverridesPayload = { overrides: {} };

export function getCachedOverrides(): RuntimeOverridesPayload {
  return cached;
}

export async function refreshRuntimeModelOverrides(): Promise<void> {
  const row = await queryOne<{ overrides: unknown }>(
    `SELECT overrides FROM runtime_model_overrides WHERE id = 1`
  );
  if (!row || row.overrides == null) {
    cached = { overrides: {} };
    return;
  }
  const raw = row.overrides as Record<string, unknown>;
  const overrides: Record<string, ModelOverrideEntry> = {};
  let embedding: string | undefined;
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'embedding' && typeof v === 'string') {
      embedding = v;
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const e = v as { primary?: string; fallback?: string };
      overrides[k] = {
        primary: typeof e.primary === 'string' ? e.primary : undefined,
        fallback: typeof e.fallback === 'string' ? e.fallback : undefined,
      };
    }
  }
  cached = { overrides, embedding };
  logger.info('Runtime model overrides refreshed from database');
}

function assertModelAllowed(role: string, model: string, kind: 'primary' | 'fallback'): void {
  const r = role as ReasoningModelRole;
  const allowed = APPROVED_REASONING_MODEL_ALLOWLIST[r];
  if (!allowed) {
    throw new Error(`Unknown role "${role}"`);
  }
  if (!allowed.includes(model as (typeof allowed)[number])) {
    throw new Error(`Model "${model}" for ${kind} role "${role}" is not in the approved allowlist`);
  }
}

export function assertEmbeddingAllowed(model: string): void {
  const normalized = model.trim();
  if (!APPROVED_EMBEDDING_MODELS.has(normalized)) {
    throw new Error(`Embedding model "${normalized}" is not in the approved embedding allowlist`);
  }
}

export function validatePerRunModelOverrides(body: unknown): PerRunModelOverrides {
  return validateAndNormalizePayload(body);
}

export function resolveRoleModelsForRun(role: ModelRole): ModelOverrideEntry {
  const o = cached.overrides[role];
  return {
    primary: o?.primary?.trim() || undefined,
    fallback: o?.fallback?.trim() || undefined,
  };
}

export function validateAndNormalizePayload(body: unknown): RuntimeOverridesPayload {
  if (!body || typeof body !== 'object') {
    throw new Error('Body must be a JSON object');
  }
  const o = body as Record<string, unknown>;
  const overrides: Record<string, ModelOverrideEntry> = {};
  let embedding: string | undefined;

  for (const [key, val] of Object.entries(o)) {
    if (key === 'embedding') {
      if (val === null || val === '') {
        embedding = undefined;
      } else if (typeof val === 'string') {
        const em = val.trim();
        if (!APPROVED_EMBEDDING_MODELS.has(em)) {
          throw new Error(`Embedding model "${em}" is not in the approved embedding allowlist`);
        }
        embedding = em;
      } else {
        throw new Error('embedding must be a string');
      }
      continue;
    }
    if (val === null || val === undefined) continue;
    if (typeof val !== 'object' || Array.isArray(val)) {
      throw new Error(`Invalid value for role "${key}"`);
    }
    const entry = val as { primary?: unknown; fallback?: unknown };
    const primary = typeof entry.primary === 'string' ? entry.primary.trim() : undefined;
    const fb = typeof entry.fallback === 'string' ? entry.fallback.trim() : undefined;
    if (primary) assertModelAllowed(key, primary, 'primary');
    if (fb) assertModelAllowed(key, fb, 'fallback');
    overrides[key] = { primary, fallback: fb };
  }

  return { overrides, embedding };
}

export async function saveRuntimeModelOverrides(payload: RuntimeOverridesPayload): Promise<void> {
  const json: Record<string, unknown> = { ...payload.overrides };
  if (payload.embedding !== undefined && payload.embedding !== '') {
    json.embedding = payload.embedding;
  }
  await query(
    `INSERT INTO runtime_model_overrides (id, overrides, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET overrides = EXCLUDED.overrides, updated_at = NOW()`,
    [JSON.stringify(json)]
  );
  await refreshRuntimeModelOverrides();
}

/** Resolve primary model for a reasoning role (env default + DB override). */
export function effectivePrimary(role: ModelRole, envDefault: string): string {
  const o = cached.overrides[role];
  return (o?.primary && o.primary.trim()) || envDefault;
}

/** Resolve fallback model for a reasoning role. */
export function effectiveFallback(role: ModelRole, envDefault: string): string {
  const o = cached.overrides[role];
  return (o?.fallback && o.fallback.trim()) || envDefault;
}

export function effectiveEmbedding(envDefault: string): string {
  return (cached.embedding && cached.embedding.trim()) || envDefault;
}
