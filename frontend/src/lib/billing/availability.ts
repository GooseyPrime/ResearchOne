import { useEffect, useState } from 'react';
import { publicApi } from '../../utils/api';
import { getClerkJwtForApi } from '../../utils/clerkSession';

/**
 * Which listed prices can be bought on this deployment (GET /billing/availability).
 * A price is available only when it is set on the server. Answered at the grain
 * the pages advertise: each billing period of a plan, each token pack.
 */
export type PlanPeriodAvailability = { monthly: boolean; annual: boolean };
export type TokenPackId = 'pack_1' | 'pack_5' | 'pack_10';

export type PurchaseAvailability = {
  plans: { pro: PlanPeriodAvailability; byok: PlanPeriodAvailability };
  addons: { living_report: Record<TokenPackId, boolean>; reverse_citation_watch: boolean };
};

export type PurchasablePlan = keyof PurchaseAvailability['plans'];
export type PurchasableAddon = keyof PurchaseAvailability['addons'];
export type BillingPeriod = keyof PlanPeriodAvailability;

/** The packs the pricing page advertises, in the order it lists them. */
export const TOKEN_PACKS: ReadonlyArray<{ id: TokenPackId; label: string }> = [
  { id: 'pack_1', label: '1 token — $10' },
  { id: 'pack_5', label: '5 tokens — $25' },
  { id: 'pack_10', label: '10 tokens — $40' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePeriods(raw: unknown): PlanPeriodAvailability | null {
  if (!isRecord(raw) || typeof raw.monthly !== 'boolean' || typeof raw.annual !== 'boolean') return null;
  return { monthly: raw.monthly, annual: raw.annual };
}

function parsePacks(raw: unknown): Record<TokenPackId, boolean> | null {
  if (!isRecord(raw)) return null;
  const { pack_1, pack_5, pack_10 } = raw;
  if (typeof pack_1 !== 'boolean' || typeof pack_5 !== 'boolean' || typeof pack_10 !== 'boolean') return null;
  return { pack_1, pack_5, pack_10 };
}

/** Returns null for anything that is not the expected shape, so a bad response is treated as "unknown". */
export function parsePurchaseAvailability(raw: unknown): PurchaseAvailability | null {
  if (!isRecord(raw) || !isRecord(raw.plans) || !isRecord(raw.addons)) return null;
  const pro = parsePeriods(raw.plans.pro);
  const byok = parsePeriods(raw.plans.byok);
  const packs = parsePacks(raw.addons.living_report);
  const rcw = raw.addons.reverse_citation_watch;
  if (!pro || !byok || !packs || typeof rcw !== 'boolean') return null;
  return { plans: { pro, byok }, addons: { living_report: packs, reverse_citation_watch: rcw } };
}

/**
 * True only when the server has said this product cannot be bought at all.
 * While the answer is unknown (first paint, prerendered HTML, a failed
 * request) the buy link stays: it leads into the app, where the same check
 * runs again before anything is sold, so an unknown answer never becomes a
 * dead end.
 */
export function planUnavailable(availability: PurchaseAvailability | null, plan: PurchasablePlan): boolean {
  if (availability === null) return false;
  const periods = availability.plans[plan];
  return !periods.monthly && !periods.annual;
}

/**
 * The advertised billing periods of a plan that cannot be bought, when the
 * plan itself still can through another period. Empty when unknown, when
 * everything is available, or when the whole plan is unavailable (the card
 * already says so).
 */
export function unavailablePlanPeriods(
  availability: PurchaseAvailability | null,
  plan: PurchasablePlan,
  advertised: readonly BillingPeriod[],
): BillingPeriod[] {
  if (availability === null || planUnavailable(availability, plan)) return [];
  const periods = availability.plans[plan];
  return advertised.filter((period) => !periods[period]);
}

export function addonUnavailable(availability: PurchaseAvailability | null, addon: PurchasableAddon): boolean {
  if (availability === null) return false;
  if (addon === 'living_report') return !Object.values(availability.addons.living_report).some(Boolean);
  return !availability.addons.reverse_citation_watch;
}

/** Advertised token packs that cannot be bought while at least one other can. */
export function unavailableTokenPacks(availability: PurchaseAvailability | null): string[] {
  if (availability === null || addonUnavailable(availability, 'living_report')) return [];
  const packs = availability.addons.living_report;
  return TOKEN_PACKS.filter((pack) => !packs[pack.id]).map((pack) => pack.label);
}

export type PricingVisitorState = {
  availability: PurchaseAvailability | null;
  /** A session exists, so buy links can skip sign-up and go straight to billing. */
  signedIn: boolean;
};

const SESSION_CHECK_DELAYS_MS = [0, 400, 1200, 2500];

/**
 * For the public pricing page, which renders without the query client or the
 * Clerk provider (it is prerendered). Plain effect + fetch on purpose.
 */
export function usePricingVisitorState(): PricingVisitorState {
  const [state, setState] = useState<PricingVisitorState>({ availability: null, signedIn: false });

  useEffect(() => {
    let cancelled = false;

    void publicApi
      .get<unknown>('/billing/availability')
      .then((res) => {
        const availability = parsePurchaseAvailability(res.data);
        if (!cancelled && availability) setState((prev) => ({ ...prev, availability }));
      })
      .catch(() => {
        // Unknown stays unknown; see planUnavailable.
      });

    // The session bridge registers after this effect and Clerk loads on its
    // own schedule, so ask a few times before settling on "signed out".
    const timers = SESSION_CHECK_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        void getClerkJwtForApi().then((token) => {
          if (!cancelled && token) setState((prev) => (prev.signedIn ? prev : { ...prev, signedIn: true }));
        });
      }, delay),
    );

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return state;
}
