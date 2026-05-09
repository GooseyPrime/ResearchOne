/**
 * Zod schemas for agent structured JSON outputs per Section 7.
 *
 * NOTE: Current agent prompts request plain-text/markdown output, not structured
 * JSON. These schemas define the target contract for when prompts are updated to
 * require JSON output. Until then, validateAgentOutput is used by future prompt
 * updates and for new agents that are designed to emit structured JSON from the start.
 * Schema validation failure triggers single retry, then escalates to fallback.
 */

import { z } from 'zod';

export const PlannerOutputSchema = z.object({
  research_questions: z.array(z.string()).min(1),
  search_strategy: z.string(),
  expected_sources: z.array(z.string()).optional(),
  scope_boundaries: z.string().optional(),
});

export const RetrieverOutputSchema = z.object({
  analysis: z.string().min(1),
  evidence_tiers: z.array(z.object({
    chunk_id: z.string(),
    tier: z.enum(['strong', 'moderate', 'weak', 'contested', 'anomalous']),
    reasoning: z.string(),
  })).optional(),
  institutional_flags: z.array(z.object({
    chunk_id: z.string(),
    status: z.string(),
    recommendation: z.string(),
  })).optional(),
});

export const ReasonerOutputSchema = z.object({
  reasoning_chains: z.string().min(1),
  hypotheses: z.array(z.object({
    hypothesis: z.string(),
    support_strength: z.enum(['strong', 'moderate', 'weak', 'speculative']),
    key_evidence: z.array(z.string()),
  })).optional(),
  unresolved_tensions: z.array(z.string()).optional(),
});

export const SkepticOutputSchema = z.object({
  challenges: z.string().min(1),
  structural_comparisons: z.array(z.object({
    source_claim: z.string(),
    contrasting_claim: z.string(),
    compatibility: z.enum(['compatible', 'incompatible', 'different_conditions', 'insufficient_data']),
    reasoning: z.string(),
  })).optional(),
  flags: z.array(z.object({
    claim: z.string(),
    issue: z.string(),
    severity: z.enum(['critical', 'significant', 'minor']),
  })).optional(),
});

export const SynthesizerOutputSchema = z.object({
  markdown: z.string().min(1),
  sections: z.array(z.object({
    title: z.string(),
    content: z.string(),
  })).optional(),
});

export const VerifierOutputSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'conditional_pass']),
  findings: z.array(z.object({
    check: z.string(),
    result: z.enum(['pass', 'fail', 'warning']),
    detail: z.string(),
  })),
  contested_source_analysis: z.boolean().optional(),
});

export const PlainLanguageSynthesizerOutputSchema = z.object({
  summary: z.string().min(1),
  key_findings: z.array(z.string()).optional(),
  caveats: z.array(z.string()).optional(),
});

export const OutlineArchitectOutputSchema = z.object({
  outline: z.array(z.object({
    title: z.string(),
    key: z.string(),
    description: z.string().optional(),
  })).min(1),
});

export const AGENT_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  planner: PlannerOutputSchema,
  retriever: RetrieverOutputSchema,
  reasoner: ReasonerOutputSchema,
  skeptic: SkepticOutputSchema,
  synthesizer: SynthesizerOutputSchema,
  verifier: VerifierOutputSchema,
  plain_language_synthesizer: PlainLanguageSynthesizerOutputSchema,
  outline_architect: OutlineArchitectOutputSchema,
};

export function validateAgentOutput(role: string, output: unknown): { valid: boolean; error?: string } {
  const schema = AGENT_OUTPUT_SCHEMAS[role];
  if (!schema) return { valid: true };

  const result = schema.safeParse(output);
  if (result.success) return { valid: true };
  return { valid: false, error: result.error.message };
}
