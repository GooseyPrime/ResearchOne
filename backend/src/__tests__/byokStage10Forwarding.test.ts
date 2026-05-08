/**
 * Test: Stage 10 (epistemic persistence) helpers forward byokApiKeyOverride
 * to callRoleModel so BYOK runs use the user's key for claims/contradictions/
 * citations extraction, not the platform key.
 *
 * Per Rule 16: This test MUST fail without the fix. The bug being prevented
 * is the WO-I gap noted in launch-readiness: extractAndPersistClaims,
 * extractAndPersistContradictions, mapAndPersistCitations called
 * callRoleModel without the BYOK key, so BYOK runs leaked Stage 10 traffic
 * onto the platform OpenRouter account.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callRoleModel: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../services/openrouter/openrouterService', async () => {
  const actual = await vi.importActual<typeof import('../services/openrouter/openrouterService')>(
    '../services/openrouter/openrouterService'
  );
  return {
    ...actual,
    callRoleModel: mocks.callRoleModel,
  };
});

vi.mock('../db/pool', () => ({
  query: mocks.query,
  queryOne: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Import after mocks so the helpers see the mocked callRoleModel
import { extractAndPersistClaims } from '../services/reasoning/claimExtractor';
import { extractAndPersistContradictions } from '../services/reasoning/contradictionExtractor';
import { mapAndPersistCitations } from '../services/reasoning/citationMapper';

const FAKE_BYOK_KEY = 'sk-or-v1-byok-fake-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('Stage 10 BYOK key forwarding (WO-I)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
  });

  it('extractAndPersistClaims passes byokApiKeyOverride to callRoleModel', async () => {
    mocks.callRoleModel.mockResolvedValueOnce({ content: '[]', model: 'm', role: 'verifier', latencyMs: 1 });

    await extractAndPersistClaims({
      runId: 'run_byok_claims',
      reportId: 'rep_byok_claims',
      researchQuery: 'q',
      chunks: [],
      reasonerOutput: '',
      synthesizerOutput: '',
      byokApiKeyOverride: FAKE_BYOK_KEY,
    });

    expect(mocks.callRoleModel).toHaveBeenCalledTimes(1);
    const callArgs = mocks.callRoleModel.mock.calls[0][0];
    expect(callArgs.byokApiKeyOverride).toBe(FAKE_BYOK_KEY);
  });

  it('extractAndPersistContradictions passes byokApiKeyOverride to callRoleModel', async () => {
    mocks.callRoleModel.mockResolvedValueOnce({ content: '[]', model: 'm', role: 'skeptic', latencyMs: 1 });

    await extractAndPersistContradictions({
      runId: 'run_byok_contra',
      reportId: 'rep_byok_contra',
      chunks: [],
      claims: [
        {
          claim_id: 'c1',
          claim_text: 'test claim',
          evidence_tier: 'inference',
          confidence: 0.5,
          source_chunk_ids: [],
          tags: [],
          is_conclusion_critical: false,
          stance_summary: '',
        },
      ],
      skepticOutput: 'skeptic output',
      byokApiKeyOverride: FAKE_BYOK_KEY,
    });

    expect(mocks.callRoleModel).toHaveBeenCalledTimes(1);
    const callArgs = mocks.callRoleModel.mock.calls[0][0];
    expect(callArgs.byokApiKeyOverride).toBe(FAKE_BYOK_KEY);
  });

  it('mapAndPersistCitations passes byokApiKeyOverride to callRoleModel', async () => {
    mocks.callRoleModel.mockResolvedValueOnce({
      content: '{"citations":[],"uncited_sections":[],"notes":""}',
      model: 'm',
      role: 'verifier',
      latencyMs: 1,
    });

    await mapAndPersistCitations({
      runId: 'run_byok_cite',
      reportId: 'rep_byok_cite',
      chunks: [],
      claims: [],
      reportSections: [{ type: 'summary', title: 'S', content: 'C' }],
      byokApiKeyOverride: FAKE_BYOK_KEY,
    });

    expect(mocks.callRoleModel).toHaveBeenCalledTimes(1);
    const callArgs = mocks.callRoleModel.mock.calls[0][0];
    expect(callArgs.byokApiKeyOverride).toBe(FAKE_BYOK_KEY);
  });

  it('Stage 10 helpers omit byokApiKeyOverride when none provided (platform key path)', async () => {
    mocks.callRoleModel.mockResolvedValue({ content: '[]', model: 'm', role: 'verifier', latencyMs: 1 });

    await extractAndPersistClaims({
      runId: 'run_no_byok',
      reportId: 'rep_no_byok',
      researchQuery: 'q',
      chunks: [],
      reasonerOutput: '',
      synthesizerOutput: '',
    });

    const callArgs = mocks.callRoleModel.mock.calls[0][0];
    expect(callArgs.byokApiKeyOverride).toBeUndefined();
  });
});
