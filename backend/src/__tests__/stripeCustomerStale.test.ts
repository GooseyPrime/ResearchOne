/**
 * A Stripe customer id stored for a user can stop existing in Stripe (deleted
 * in the dashboard, or created in another mode). Reusing it made every checkout
 * for that user fail with "No such customer". The stored id must be checked and
 * replaced when it is gone, and kept when Stripe is merely unreachable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  retrieveMock: vi.fn(),
  searchMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('../db/pool', () => ({
  query: mocks.queryMock,
  queryOne: mocks.queryOneMock,
}));

vi.mock('../services/billing/stripeClient', () => ({
  getStripeClient: () => ({
    customers: {
      retrieve: mocks.retrieveMock,
      search: mocks.searchMock,
      create: mocks.createMock,
    },
  }),
}));

import { getOrCreateStripeCustomer } from '../services/billing/stripeCustomer';

const USER = 'user_stale_customer_test';

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.queryMock.mockResolvedValue([]);
  mocks.searchMock.mockResolvedValue({ data: [] });
  mocks.createMock.mockResolvedValue({ id: 'cus_new' });
});

describe('getOrCreateStripeCustomer — stored id that no longer exists', () => {
  it('reuses a stored customer that still exists', async () => {
    mocks.queryOneMock.mockResolvedValue({ stripe_customer_id: 'cus_live' });
    mocks.retrieveMock.mockResolvedValue({ id: 'cus_live', object: 'customer' });

    await expect(getOrCreateStripeCustomer(USER, 'a@example.org')).resolves.toBe('cus_live');
    expect(mocks.createMock).not.toHaveBeenCalled();
    expect(mocks.queryMock).not.toHaveBeenCalled();
  });

  it('replaces a stored customer that Stripe reports as deleted, and updates the mapping', async () => {
    mocks.queryOneMock.mockResolvedValue({ stripe_customer_id: 'cus_deleted' });
    mocks.retrieveMock.mockResolvedValue({ id: 'cus_deleted', object: 'customer', deleted: true });

    await expect(getOrCreateStripeCustomer(USER, 'a@example.org')).resolves.toBe('cus_new');
    expect(mocks.createMock).toHaveBeenCalledWith({ email: 'a@example.org', metadata: { user_id: USER } });
    expect(mocks.queryMock).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (user_id) DO UPDATE'), [
      USER,
      'cus_new',
    ]);
  });

  it('replaces a stored customer id Stripe has never heard of', async () => {
    mocks.queryOneMock.mockResolvedValue({ stripe_customer_id: 'cus_other_mode' });
    mocks.retrieveMock.mockRejectedValue(Object.assign(new Error('No such customer'), { code: 'resource_missing' }));

    await expect(getOrCreateStripeCustomer(USER, null)).resolves.toBe('cus_new');
  });

  it('prefers an existing live customer found by user id over creating another', async () => {
    mocks.queryOneMock.mockResolvedValue({ stripe_customer_id: 'cus_deleted' });
    mocks.retrieveMock.mockResolvedValue({ id: 'cus_deleted', deleted: true });
    mocks.searchMock.mockResolvedValue({ data: [{ id: 'cus_found' }] });

    await expect(getOrCreateStripeCustomer(USER, null)).resolves.toBe('cus_found');
    expect(mocks.createMock).not.toHaveBeenCalled();
  });

  it('keeps the stored customer when Stripe cannot be reached', async () => {
    mocks.queryOneMock.mockResolvedValue({ stripe_customer_id: 'cus_live' });
    mocks.retrieveMock.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

    await expect(getOrCreateStripeCustomer(USER, null)).resolves.toBe('cus_live');
    expect(mocks.createMock).not.toHaveBeenCalled();
  });
});
