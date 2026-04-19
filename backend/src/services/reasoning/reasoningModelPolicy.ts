/**
 * Canonical list of OpenRouter-backed agent roles for ResearchOne (research pipeline,
 * report generation, revisions). Order is stable for UI and DB; do not rename without
 * updating call sites and migrations.
 */
export const REASONING_MODEL_ROLES = [
  'planner',
  'retriever',
  'reasoner',
  'skeptic',
  'synthesizer',
  'verifier',
  'outline_architect',
  'section_drafter',
  'internal_challenger',
  'coherence_refiner',
  'revision_intake',
  'report_locator',
  'change_planner',
  'section_rewriter',
  'citation_integrity_checker',
  'final_revision_verifier',
] as const;

export type ReasoningModelRole = (typeof REASONING_MODEL_ROLES)[number];

const BASE_ALLOWLIST = [
  'deepseek/deepseek-r1',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-haiku',
  'openai/o3-mini',
  'openai/o3',
  'openai/o1',
] as const;

export const APPROVED_REASONING_MODEL_ALLOWLIST = Object.fromEntries(
  REASONING_MODEL_ROLES.map((role) => [role, BASE_ALLOWLIST as readonly string[]])
) as Record<ReasoningModelRole, readonly string[]>;

export function validateReasoningModelPolicy(args: {
  models: Record<ReasoningModelRole, string | undefined>;
  fallbacks: Record<ReasoningModelRole, string | undefined>;
}): void {
  for (const role of REASONING_MODEL_ROLES) {
    const active = args.models[role]?.trim();
    const fallback = args.fallbacks[role]?.trim();
    const allowed = APPROVED_REASONING_MODEL_ALLOWLIST[role];

    if (!active) {
      throw new Error(`Model policy violation: required active model missing for role "${role}"`);
    }
    if (!fallback) {
      throw new Error(`Model policy violation: required fallback model missing for role "${role}"`);
    }

    if (!allowed.includes(active)) {
      throw new Error(
        `Model policy violation: active model "${active}" for role "${role}" is not in approved reasoning allowlist`
      );
    }
    if (!allowed.includes(fallback)) {
      throw new Error(
        `Model policy violation: fallback model "${fallback}" for role "${role}" is not in approved reasoning allowlist`
      );
    }
  }
}
