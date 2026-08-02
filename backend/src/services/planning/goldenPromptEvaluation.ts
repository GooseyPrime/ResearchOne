import type { GoldenPromptCase } from './goldenPromptSuite';

export interface GoldenPromptEvaluationInput {
  testCase: GoldenPromptCase;
  reportMarkdown: string;
  sourceCount: number;
  citationCount: number;
  expectedArtifactCount?: number;
  actualArtifactCount?: number;
  hasFabricatedCitation?: boolean;
  contractPassed: boolean;
  verifierPassed: boolean;
  latencyMs: number;
  tokenCount: number;
}

export interface GoldenPromptEvaluationResult {
  score: number;
  hardFailures: string[];
  dimensionScores: Record<string, number>;
}

export function evaluateGoldenPromptRun(input: GoldenPromptEvaluationInput): GoldenPromptEvaluationResult {
  const hardFailures: string[] = [];
  if (!input.contractPassed) hardFailures.push('contract_audit_failed');
  if (!input.verifierPassed) hardFailures.push('verifier_failed');
  if (input.hasFabricatedCitation) hardFailures.push('fabricated_citation_detected');
  if (
    typeof input.expectedArtifactCount === 'number' &&
    typeof input.actualArtifactCount === 'number' &&
    input.expectedArtifactCount !== input.actualArtifactCount
  ) {
    hardFailures.push('artifact_count_mismatch');
  }

  const dimensionScores: Record<string, number> = {
    intent_fidelity: input.reportMarkdown.length > 800 ? 20 : 10,
    artifact_completeness:
      typeof input.expectedArtifactCount === 'number' &&
      typeof input.actualArtifactCount === 'number' &&
      input.expectedArtifactCount === input.actualArtifactCount
        ? 20
        : 5,
    evidence_coverage: input.sourceCount >= 8 ? 15 : 7,
    citation_accuracy: input.citationCount >= 8 ? 15 : 7,
    analytical_rigor: input.verifierPassed ? 10 : 3,
    source_diversity: input.sourceCount >= 10 ? 10 : 5,
    readability: input.reportMarkdown.split('\n').length >= 12 ? 5 : 2,
    cost_latency_efficiency: input.latencyMs < 25 * 60 * 1000 && input.tokenCount < 260000 ? 5 : 2,
  };
  const score = Object.values(dimensionScores).reduce((sum, value) => sum + value, 0);
  return { score, hardFailures, dimensionScores };
}
