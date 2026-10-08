import { useEffect, useState } from 'react';
import { publicApi } from '../../utils/api';
import { getClerkJwtForApi } from '../../utils/clerkSession';

/**
 * Which listed prices can be bought on this deployment (GET /billing/availability).
 * A product is available only when its Stripe price is set on the server.
 */
export type PurchaseAvailability = {
  plans: { pro: boolean; byok: boolean };
  addons: { living_report: boolean; reverse_citation_watch: boolean };
};

export type PurchasablePlan = keyof PurchaseAvailability['plans'];
export type PurchasableAddon = keyof PurchaseAvailability['addons'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Returns null for anything that is not the expected shape, so a bad response is treated as "unknown". */
export function parsePurchaseAvailability(raw: unknown): PurchaseAvailability | null {
  if (!isRecord(raw) || !isRecord(raw.plans) || !isRecord(raw.addons)) return null;
  const { plans, addons } = raw;
  if (
    typeof plans.pro !== 'boolean' ||
    typeof plans.byok !== 'boolean' ||
    typeof addons.living_report !== 'boolean' ||
    typeof addons.reverse_citation_watch !== 'boolean'
  ) {
    return null;
  }
  return {
    plans: { pro: plans.pro, byok: plans.byok },
    addons: {
      living_report: addons.living_report,
      reverse_citation_watch: addons.reverse_citation_watch,
    },
  };
}

/**
 * True only when the server has said this product cannot be bought. While the
 * answer is unknown (first paint, prerendered HTML, a failed request) the buy
 * link stays: it leads into the app, where the same check runs again before
 * anything is sold, so an unknown answer never becomes a dead end.
 */
export function planUnavailable(availability: PurchaseAvailability | null, plan: PurchasablePlan): boolean {
  return availability !== null && !availability.plans[plan];
}

export function addonUnavailable(availability: PurchaseAvailability | null, addon: PurchasableAddon): boolean {
  return availability !== null && !availability.addons[addon];
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
