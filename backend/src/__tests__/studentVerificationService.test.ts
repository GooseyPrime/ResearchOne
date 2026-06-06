import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../config', () => ({
  config: {
    nodeEnv: 'test',
    sheerid: { apiToken: 'test-token', programId: 'test-program' },
  },
}));
vi.mock('../db/pool', () => ({
  get query() {
    return queryMock;
  },
  get queryOne() {
    return queryOneMock;
  },
}));
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  recordStudentVerification,
  sheerIdPayloadIndicatesSuccess,
} from '../services/billing/studentVerificationService';

describe('sheerIdPayloadIndicatesSuccess', () => {
  it('accepts lowercase success step from REST v2', () => {
    expect(sheerIdPayloadIndicatesSuccess({ currentStep: 'success', verificationId: 'v1' })).toBe(true);
  });

  it('accepts uppercase SUCCESS step', () => {
    expect(sheerIdPayloadIndicatesSuccess({ currentStep: 'SUCCESS' })).toBe(true);
  });

  it('accepts rewardCode without success step', () => {
    expect(sheerIdPayloadIndicatesSuccess({ currentStep: 'pending', rewardCode: 'abc' })).toBe(true);
  });

  it('rejects incomplete verification payloads', () => {
    expect(sheerIdPayloadIndicatesSuccess({ currentStep: 'pending' })).toBe(false);
  });
});

describe('recordStudentVerification', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    process.env.SHEERID_DEV_BYPASS = '0';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects verification id already linked to another user', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ currentStep: 'success', verificationId: 'vid-reused' }),
    });
    queryOneMock.mockResolvedValueOnce({ id: 'other-user' });

    const result = await recordStudentVerification('user-new', 'vid-reused');

    expect(result).toEqual({
      verified: false,
      error: 'This student verification is already linked to another account',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('persists verification when id is unused and SheerID reports success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ currentStep: 'success', verificationId: 'vid-ok' }),
    });
    queryOneMock.mockResolvedValueOnce(null);
    queryMock.mockResolvedValueOnce([]);

    const result = await recordStudentVerification('user-new', 'vid-ok');

    expect(result).toEqual({ verified: true });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('verified_student = true'),
      ['user-new', 'vid-ok'],
    );
  });
});
