import { describe, expect, it, vi, beforeEach } from 'vitest';

const adminQueryMock = vi.fn();
const queryMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('../db/pool', () => ({
  get query() { return queryMock; },
  get adminQuery() { return adminQueryMock; },
  get withTransaction() { return withTransactionMock; },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { writeAdminAction } from '../api/admin/adminAuditLog';

describe('admin dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('writeAdminAction', () => {
    it('writes an audit row with admin ID, target, action, reason', async () => {
      adminQueryMock.mockResolvedValueOnce([]);
      await writeAdminAction('admin_1', 'user_1', 'wallet_credit', 'comp for journalist', { amountCents: 5000 });

      expect(adminQueryMock).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admin_actions_log'),
        expect.arrayContaining(['admin_1', 'user_1', 'wallet_credit', 'comp for journalist'])
      );
    });

    it('tolerates missing admin_actions_log table', async () => {
      adminQueryMock.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
      await expect(writeAdminAction('admin_1', 'user_1', 'test', 'test')).resolves.not.toThrow();
    });
  });

  describe('admin access control', () => {
    it('requireAdmin is used on the admin router', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const adminRouterSrc = fs.readFileSync(
        path.join(__dirname, '../api/routes/admin.ts'),
        'utf8'
      );
      expect(adminRouterSrc).toContain('requireAdmin');
      expect(adminRouterSrc).toContain('router.use(requireAdmin)');
    });
  });

  describe('wallet adjustment writes audit log', () => {
    it('writeAdminAction captures all required fields', async () => {
      adminQueryMock.mockResolvedValueOnce([]);
      await writeAdminAction('admin_123', 'target_456', 'wallet_debit', 'refund', { amountCents: 1000, newBalance: 4000 });

      const call = adminQueryMock.mock.calls[0];
      expect(call[0]).toContain('INSERT INTO admin_actions_log');
      const params = call[1] as string[];
      expect(params[0]).toBe('admin_123');
      expect(params[1]).toBe('target_456');
      expect(params[2]).toBe('wallet_debit');
      expect(params[3]).toBe('refund');
      expect(params[4]).toContain('1000');
    });
  });
});
