import { describe, expect, it } from 'vitest';

import { evaluateGoldenPromptRun } from '../services/planning/goldenPromptEvaluation';
import type { GoldenPromptCase } from '../services/planning/goldenPromptSuite';

const CASE: GoldenPromptCase = {
  id: 'opportunity_discovery:deep',
  intent: 'opportunity_discovery',
  depth: 'deep',
  prompt: 'test prompt',
};

describe('goldenPromptEvaluation', () => {
  it('flags hard failures for count mismatch and contract failure', () => {
    const result = evaluateGoldenPromptRun({
      testCase: CASE,
      reportMarkdown: '# Report\ncontent',
      sourceCount: 6,
      citationCount: 2,
      expectedArtifactCount: 10,
      actualArtifactCount: 6,
      contractPassed: false,
      verifierPassed: false,
      latencyMs: 1200,
      tokenCount: 1000,
    });

    expect(result.hardFailures).toContain('artifact_count_mismatch');
    expect(result.hardFailures).toContain('contract_audit_failed');
    expect(result.hardFailures).toContain('verifier_failed');
  });
});
