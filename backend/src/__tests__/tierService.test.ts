import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../db/pool', () => ({
  get query() { return queryMock; },
  get queryOne() { return queryOneMock; },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  checkTierAccess,
  getUserTier,
  resetMonthlyCounters,
  incrementReportCount,
  type UserTierRow,
} from '../services/tier/tierService';

/** `checkTierAccess` uses `getOrCreateUserTier` → exists probe then full row. */
function mockPersistedUserTier(row: UserTierRow): void {
  queryOneMock.mockResolvedValueOnce({ user_id: row.user_id });
  queryOneMock.mockResolvedValueOnce(row);
}

describe('tierService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserTier', () => {
    it('returns default free_demo when no row exists', async () => {
      queryOneMock.mockResolvedValueOnce(null);
      const tier = await getUserTier('user_new');
      expect(tier.tier).toBe('free_demo');
      expect(tier.lifetime_reports_used).toBe(0);
    });

    it('returns the stored tier when row exists', async () => {
      queryOneMock.mockResolvedValueOnce({
        user_id: 'user_pro',
        tier: 'pro',
        org_id: null,
        current_period_reports_used: 5,
        current_period_deep_reports_used: 1,
        lifetime_reports_used: 42,
        current_period_resets_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-05-07T00:00:00Z',
      });
      const tier = await getUserTier('user_pro');
      expect(tier.tier).toBe('pro');
      expect(tier.current_period_reports_used).toBe(5);
      expect(tier.lifetime_reports_used).toBe(42);
    });

    it('tolerates table not existing (42P01)', async () => {
      queryOneMock.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
      const tier = await getUserTier('user_no_table');
      expect(tier.tier).toBe('free_demo');
    });
  });

  describe('checkTierAccess — free_demo', () => {
    it('allows GENERAL_EPISTEMIC_RESEARCH', async () => {
      mockPersistedUserTier({
        user_id: 'u1', tier: 'free_demo', org_id: null,
        current_period_reports_used: 0, current_period_deep_reports_used: 0,
        lifetime_reports_used: 0, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u1', 'GENERAL_EPISTEMIC_RESEARCH');
      expect(result.allowed).toBe(true);
    });

    it('denies INVESTIGATIVE_SYNTHESIS with 403 and upgrade_path', async () => {
      mockPersistedUserTier({
        user_id: 'u1', tier: 'free_demo', org_id: null,
        current_period_reports_used: 0, current_period_deep_reports_used: 0,
        lifetime_reports_used: 0, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u1', 'INVESTIGATIVE_SYNTHESIS');
      expect(result.allowed).toBe(false);
      expect(result.httpStatus).toBe(403);
      expect(result.upgradePath).toBe('/pricing');
    });

    it('denies after lifetime cap of 2 is reached', async () => {
      mockPersistedUserTier({
        user_id: 'u1', tier: 'free_demo', org_id: null,
        current_period_reports_used: 2, current_period_deep_reports_used: 0,
        lifetime_reports_used: 2, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u1', 'GENERAL_EPISTEMIC_RESEARCH');
      expect(result.allowed).toBe(false);
      expect(result.httpStatus).toBe(403);
    });

    it('allows when lifetime reports used is below cap', async () => {
      mockPersistedUserTier({
        user_id: 'u1', tier: 'free_demo', org_id: null,
        current_period_reports_used: 1, current_period_deep_reports_used: 0,
        lifetime_reports_used: 1, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u1', 'GENERAL_EPISTEMIC_RESEARCH');
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkTierAccess — student monthly cap', () => {
    it('denies at monthly cap with $0 wallet (402)', async () => {
      mockPersistedUserTier({
        user_id: 'u2', tier: 'student', org_id: null,
        current_period_reports_used: 10, current_period_deep_reports_used: 0,
        lifetime_reports_used: 50, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u2', 'GENERAL_EPISTEMIC_RESEARCH', 0);
      expect(result.allowed).toBe(false);
      expect(result.httpStatus).toBe(402);
      expect(result.checkoutPath).toBe('/app/billing');
    });

    it('allows at monthly cap when wallet has balance', async () => {
      mockPersistedUserTier({
        user_id: 'u2', tier: 'student', org_id: null,
        current_period_reports_used: 10, current_period_deep_reports_used: 0,
        lifetime_reports_used: 50, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u2', 'GENERAL_EPISTEMIC_RESEARCH', 1000);
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkTierAccess — pro', () => {
    it('allows any objective', async () => {
      mockPersistedUserTier({
        user_id: 'u3', tier: 'pro', org_id: null,
        current_period_reports_used: 0, current_period_deep_reports_used: 0,
        lifetime_reports_used: 0, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u3', 'ANOMALY_CORRELATION');
      expect(result.allowed).toBe(true);
    });

    it('allows with reports remaining', async () => {
      mockPersistedUserTier({
        user_id: 'u3', tier: 'pro', org_id: null,
        current_period_reports_used: 0, current_period_deep_reports_used: 0,
        lifetime_reports_used: 0, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u3', 'GENERAL_EPISTEMIC_RESEARCH');
      expect(result.allowed).toBe(true);
    });

    it('denies when monthly cap reached and wallet is $0', async () => {
      mockPersistedUserTier({
        user_id: 'u3', tier: 'pro', org_id: null,
        current_period_reports_used: 25, current_period_deep_reports_used: 5,
        lifetime_reports_used: 100, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u3', 'GENERAL_EPISTEMIC_RESEARCH', 0);
      expect(result.allowed).toBe(false);
      expect(result.httpStatus).toBe(402);
    });

    it('allows when monthly cap reached but wallet has $10', async () => {
      mockPersistedUserTier({
        user_id: 'u3', tier: 'pro', org_id: null,
        current_period_reports_used: 25, current_period_deep_reports_used: 5,
        lifetime_reports_used: 100, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u3', 'GENERAL_EPISTEMIC_RESEARCH', 1000);
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkTierAccess — admin / sovereign', () => {
    it('admin allows any objective with no caps', async () => {
      mockPersistedUserTier({
        user_id: 'u_admin', tier: 'admin', org_id: null,
        current_period_reports_used: 999, current_period_deep_reports_used: 999,
        lifetime_reports_used: 9999, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u_admin', 'PATENT_GAP_ANALYSIS');
      expect(result.allowed).toBe(true);
    });

    it('sovereign allows any objective with no caps', async () => {
      mockPersistedUserTier({
        user_id: 'u_sov', tier: 'sovereign', org_id: null,
        current_period_reports_used: 999, current_period_deep_reports_used: 999,
        lifetime_reports_used: 9999, current_period_resets_at: null, updated_at: '',
      });
      const result = await checkTierAccess('u_sov', 'ANOMALY_CORRELATION');
      expect(result.allowed).toBe(true);
    });
  });

  describe('resetMonthlyCounters', () => {
    it('resets users whose period has passed', async () => {
      queryMock.mockResolvedValueOnce([{ user_id: 'u1' }, { user_id: 'u2' }]);
      const count = await resetMonthlyCounters();
      expect(count).toBe(2);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('current_period_resets_at <= NOW()'),
        []
      );
    });

    it('returns 0 when no users need reset', async () => {
      queryMock.mockResolvedValueOnce([]);
      const count = await resetMonthlyCounters();
      expect(count).toBe(0);
    });

    it('tolerates table not existing', async () => {
      queryMock.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
      const count = await resetMonthlyCounters();
      expect(count).toBe(0);
    });
  });

  describe('incrementReportCount', () => {
    it('upserts user_tiers and increments lifetime for non-deep reports', async () => {
      queryMock.mockResolvedValueOnce([]);
      await incrementReportCount('u1', false);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO user_tiers');
      expect(sql).toContain('ON CONFLICT (user_id) DO UPDATE');
      expect(sql).toContain('lifetime_reports_used = user_tiers.lifetime_reports_used + 1');
      expect(sql).toContain(
        'current_period_resets_at = COALESCE(user_tiers.current_period_resets_at, EXCLUDED.current_period_resets_at)'
      );
      expect(params[0]).toBe('u1');
      expect(params[2]).toBe(0);
    });

    it('upserts with deep counter increment for deep reports', async () => {
      queryMock.mockResolvedValueOnce([]);
      await incrementReportCount('u1', true);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO user_tiers');
      expect(sql).toContain('current_period_deep_reports_used');
      expect(params[2]).toBe(1);
    });
  });
});
