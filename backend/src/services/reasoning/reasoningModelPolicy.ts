export type ReasoningModelRole =
  | 'planner'
  | 'retriever'
  | 'reasoner'
  | 'skeptic'
  | 'synthesizer'
  | 'verifier'
  | 'outline_architect'
  | 'section_drafter'
  | 'internal_challenger'
  | 'coherence_refiner'
  | 'revision_intake'
  | 'report_locator'
  | 'change_planner'
  | 'section_rewriter'
  | 'citation_integrity_checker'
  | 'final_revision_verifier';

const BASE_ALLOWLIST = [
  'deepseek/deepseek-r1',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.7-sonnet',
  'openai/o3-mini',
  'openai/o3',
  'openai/o1',
] as const;

export const APPROVED_REASONING_MODEL_ALLOWLIST: Record<ReasoningModelRole, readonly string[]> = {
  planner: BASE_ALLOWLIST,
  retriever: BASE_ALLOWLIST,
  reasoner: BASE_ALLOWLIST,
  skeptic: BASE_ALLOWLIST,
  synthesizer: BASE_ALLOWLIST,
  verifier: BASE_ALLOWLIST,
  outline_architect: BASE_ALLOWLIST,
  section_drafter: BASE_ALLOWLIST,
  internal_challenger: BASE_ALLOWLIST,
  coherence_refiner: BASE_ALLOWLIST,
  revision_intake: BASE_ALLOWLIST,
  report_locator: BASE_ALLOWLIST,
  change_planner: BASE_ALLOWLIST,
  section_rewriter: BASE_ALLOWLIST,
  citation_integrity_checker: BASE_ALLOWLIST,
  final_revision_verifier: BASE_ALLOWLIST,
};

export function validateReasoningModelPolicy(args: {
  models: Record<ReasoningModelRole, string | undefined>;
  fallbacks: Record<ReasoningModelRole, string | undefined>;
}): void {
  const roles = Object.keys(APPROVED_REASONING_MODEL_ALLOWLIST) as ReasoningModelRole[];

  for (const role of roles) {
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
