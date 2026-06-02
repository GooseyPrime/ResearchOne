import { describe, expect, it, vi, beforeEach } from 'vitest';

const adminQueryMock = vi.fn();

vi.mock('../db/pool', () => ({
  adminQuery: (...args: unknown[]) => adminQueryMock(...args),
}));

import {
  assignLegacyResearchOwnership,
  hasDeployMarker,
  resolveLegacyOwnerUserId,
} from '../scripts/legacyResearchOwnership';

beforeEach(() => {
  adminQueryMock.mockReset();
});

describe('legacyResearchOwnership', () => {
  it('resolveLegacyOwnerUserId prefers LEGACY_OWNER_USER_ID env', async () => {
    const id = await resolveLegacyOwnerUserId('user_clerk_abc', undefined);
    expect(id).toBe('user_clerk_abc');
    expect(adminQueryMock).not.toHaveBeenCalled();
  });

  it('resolveLegacyOwnerUserId looks up email when user id unset', async () => {
    adminQueryMock.mockResolvedValueOnce([{ id: 'user_from_email' }]);
    const id = await resolveLegacyOwnerUserId(undefined, 'brandon@intellmeai.com');
    expect(id).toBe('user_from_email');
  });

  it('assignLegacyResearchOwnership skips when marker exists', async () => {
    adminQueryMock.mockResolvedValueOnce([{ key: 'p0_legacy_research_assigned_to_owner_v1' }]);
    const result = await assignLegacyResearchOwnership({
      ownerUserId: 'user_a',
      scope: 'all_existing',
    });
    expect(result.skipped).toBe(true);
  });

  it('hasDeployMarker returns false when table missing', async () => {
    adminQueryMock.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: '42P01' }));
    await expect(hasDeployMarker('x')).resolves.toBe(false);
  });
});
