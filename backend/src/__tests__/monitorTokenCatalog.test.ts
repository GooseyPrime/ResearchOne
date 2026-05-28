import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({
  config: {
    stripe: {
      priceIds: {
        monitorTokenPack1: 'price_pack_1',
        monitorTokenPack5: 'price_pack_5',
        monitorTokenPack10: 'price_pack_10',
      },
    },
  },
}));

import {
  listMonitorTokenPackages,
  resolveMonitorTokenPackage,
  resolveMonitorTokenPackageByPriceId,
} from '../services/billing/monitorTokenCatalog';

describe('monitorTokenCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists all configured packages', () => {
    const packages = listMonitorTokenPackages();
    expect(packages).toHaveLength(3);
    expect(packages.map((p) => p.id).sort()).toEqual(['pack_1', 'pack_10', 'pack_5']);
    expect(packages.find((p) => p.id === 'pack_5')?.tokenCount).toBe(5);
  });

  it('resolves package by id and price id', () => {
    expect(resolveMonitorTokenPackage('pack_1')?.tokenCount).toBe(1);
    expect(resolveMonitorTokenPackageByPriceId('price_pack_10')?.id).toBe('pack_10');
    expect(resolveMonitorTokenPackage('unknown')).toBeNull();
  });
});
