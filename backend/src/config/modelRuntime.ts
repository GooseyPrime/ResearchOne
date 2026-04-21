import { query } from '../db/pool';
import { config } from './index';
import {
  validateReasoningModelPolicy,
  REASONING_MODEL_ROLES,
  type ReasoningModelRole,
  MODEL_LATERAL_THINKER_V2,
  MODEL_STRICT_LOGICIAN_PRIMARY_V2,
  MODEL_STRICT_LOGICIAN_FALLBACK_V2,
  MODEL_FAST_EXTRACTOR_V2,
  MODEL_UNBIASED_CHALLENGER_PRIMARY_V2,
  MODEL_UNBIASED_CHALLENGER_FALLBACK_V2,
} from '../services/reasoning/reasoningModelPolicy';

export {
  MODEL_LATERAL_THINKER_V2,
  MODEL_STRICT_LOGICIAN_PRIMARY_V2,
  MODEL_STRICT_LOGICIAN_FALLBACK_V2,
  MODEL_FAST_EXTRACTOR_V2,
  MODEL_UNBIASED_CHALLENGER_PRIMARY_V2,
  MODEL_UNBIASED_CHALLENGER_FALLBACK_V2,
};

export type ResolvedReasoningModels = Record<
  ReasoningModelRole,
  { primary: string; fallback: string }
>;

export interface ResolvedModels {
  embedding: string;
  reasoning: ResolvedReasoningModels;
}

/** Same order and keys as `REASONING_MODEL_ROLES` in reasoningModelPolicy (single spec). */
export const REASONING_KEYS = REASONING_MODEL_ROLES;

/** Defaults from env (config) — single source for merge. */
export function baseModelsFromConfig(): ResolvedModels {
  return {
    embedding: config.models.embedding,
    reasoning: {
      planner: { primary: config.models.planner, fallback: config.models.fallbacks.planner },
      retriever: { primary: config.models.retriever, fallback: config.models.fallbacks.retriever },
      reasoner: { primary: config.models.reasoner, fallback: config.models.fallbacks.reasoner },
      skeptic: { primary: config.models.skeptic, fallback: config.models.fallbacks.skeptic },
      synthesizer: { primary: config.models.synthesizer, fallback: config.models.fallbacks.synthesizer },
      verifier: { primary: config.models.verifier, fallback: config.models.fallbacks.verifier },
      plain_language_synthesizer: {
        primary: config.models.plainLanguageSynthesizer,
        fallback: config.models.fallbacks.plainLanguageSynthesizer,
      },
      outline_architect: {
        primary: config.models.outlineArchitect,
        fallback: config.models.fallbacks.outlineArchitect,
      },
      section_drafter: {
        primary: config.models.sectionDrafter,
        fallback: config.models.fallbacks.sectionDrafter,
      },
      internal_challenger: {
        primary: config.models.internalChallenger,
        fallback: config.models.fallbacks.internalChallenger,
      },
      coherence_refiner: {
        primary: config.models.coherenceRefiner,
        fallback: config.models.fallbacks.coherenceRefiner,
      },
      revision_intake: {
        primary: config.models.revisionIntake,
        fallback: config.models.fallbacks.revisionIntake,
      },
      report_locator: {
        primary: config.models.reportLocator,
        fallback: config.models.fallbacks.reportLocator,
      },
      change_planner: {
        primary: config.models.changePlanner,
        fallback: config.models.fallbacks.changePlanner,
      },
      section_rewriter: {
        primary: config.models.sectionRewriter,
        fallback: config.models.fallbacks.sectionRewriter,
      },
      citation_integrity_checker: {
        primary: config.models.citationIntegrityChecker,
        fallback: config.models.fallbacks.citationIntegrityChecker,
      },
      final_revision_verifier: {
        primary: config.models.finalRevisionVerifier,
        fallback: config.models.fallbacks.finalRevisionVerifier,
      },
    },
  };
}

function mergeOverrides(
  base: ResolvedModels,
  rows: Array<{ role_key: string; primary_model: string; fallback_model: string | null }>
): ResolvedModels {
  const reasoning: ResolvedReasoningModels = { ...base.reasoning };
  let embedding = base.embedding;

  for (const row of rows) {
    const pk = row.primary_model.trim();
    const fk = (row.fallback_model ?? '').trim();

    if (row.role_key === 'embedding') {
      if (pk) embedding = pk;
      continue;
    }

    if (!REASONING_KEYS.includes(row.role_key as ReasoningModelRole)) continue;
    const role = row.role_key as ReasoningModelRole;
    if (pk && fk) {
      reasoning[role] = { primary: pk, fallback: fk };
    }
  }

  return { embedding, reasoning };
}

let cache: ResolvedModels | null = null;

/** Validate `config` env defaults only (before DB). */
export function validateEnvModelPolicy(): void {
  const b = baseModelsFromConfig();
  const models = {} as Record<ReasoningModelRole, string | undefined>;
  const fallbacks = {} as Record<ReasoningModelRole, string | undefined>;
  for (const k of REASONING_MODEL_ROLES) {
    models[k] = b.reasoning[k].primary;
    fallbacks[k] = b.reasoning[k].fallback;
  }
  validateReasoningModelPolicy({ models, fallbacks });
}

export function getResolvedModelsOrConfig(): ResolvedModels {
  return cache ?? baseModelsFromConfig();
}

export async function refreshModelRuntimeCache(): Promise<void> {
  const base = baseModelsFromConfig();
  try {
    const rows = await query<{
      role_key: string;
      primary_model: string;
      fallback_model: string | null;
    }>(`SELECT role_key, primary_model, fallback_model FROM runtime_model_settings`);
    cache = mergeOverrides(base, rows);
  } catch {
    cache = base;
  }

  const models: Record<ReasoningModelRole, string | undefined> = {} as Record<
    ReasoningModelRole,
    string | undefined
  >;
  const fallbacks: Record<ReasoningModelRole, string | undefined> = {} as Record<
    ReasoningModelRole,
    string | undefined
  >;
  for (const k of REASONING_MODEL_ROLES) {
    models[k] = cache.reasoning[k].primary;
    fallbacks[k] = cache.reasoning[k].fallback;
  }
  validateReasoningModelPolicy({ models, fallbacks });
}

export function getBaseModelsForApi(): ResolvedModels {
  return baseModelsFromConfig();
}

export function getEffectiveModelsForApi(): ResolvedModels {
  return getResolvedModelsOrConfig();
}

const EMBEDDING_ID_RE = /^[a-z0-9][a-z0-9\-._/]*$/i;

export function assertValidEmbeddingModelId(raw: string): void {
  const s = raw.trim();
  if (s.length < 3 || s.length > 200 || !EMBEDDING_ID_RE.test(s)) {
    throw new Error(
      'Invalid embedding model id: use an OpenRouter model slug (e.g. openai/text-embedding-3-small)'
    );
  }
}
