import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import { requireAuth } from '../middleware/clerkAuth';

describe('research routes auth guard', () => {
  it('rejects unauthenticated request with 401 before handler work', () => {
    const req = { auth: { userId: null } } as unknown as Request;
    const res = { status: vi.fn(() => res), json: vi.fn() } as unknown as Response;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
