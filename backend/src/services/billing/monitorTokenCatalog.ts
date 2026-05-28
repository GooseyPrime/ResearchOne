import { config } from '../../config';

export type MonitorTokenPackageId = 'pack_1' | 'pack_5' | 'pack_10';

export interface MonitorTokenPackage {
  id: MonitorTokenPackageId;
  label: string;
  tokenCount: number;
  priceCents: number;
  priceId: string;
}

const PACKAGE_DEFS: Array<Omit<MonitorTokenPackage, 'priceId'> & { priceIdKey: keyof typeof config.stripe.priceIds }> = [
  { id: 'pack_1', label: '1 token — $10', tokenCount: 1, priceCents: 1000, priceIdKey: 'monitorTokenPack1' },
  { id: 'pack_5', label: '5 tokens — $25', tokenCount: 5, priceCents: 2500, priceIdKey: 'monitorTokenPack5' },
  { id: 'pack_10', label: '10 tokens — $40', tokenCount: 10, priceCents: 4000, priceIdKey: 'monitorTokenPack10' },
];

export function listMonitorTokenPackages(): MonitorTokenPackage[] {
  return PACKAGE_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    tokenCount: def.tokenCount,
    priceCents: def.priceCents,
    priceId: String(config.stripe.priceIds[def.priceIdKey] ?? ''),
  })).filter((p) => Boolean(p.priceId));
}

export function resolveMonitorTokenPackage(packageId: string): MonitorTokenPackage | null {
  return listMonitorTokenPackages().find((p) => p.id === packageId) ?? null;
}

export function resolveMonitorTokenPackageByPriceId(priceId: string): MonitorTokenPackage | null {
  if (!priceId.trim()) return null;
  return listMonitorTokenPackages().find((p) => p.priceId === priceId) ?? null;
}

export const MONITOR_TOKEN_ACTIVE_MONTHS = 2;
