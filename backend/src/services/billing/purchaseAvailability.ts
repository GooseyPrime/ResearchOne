import { config } from '../../config';
import { listMonitorTokenPackages, type MonitorTokenPackageId } from './monitorTokenCatalog';

/**
 * Which of the prices shown to a visitor can actually be bought on this
 * deployment. A price is purchasable only when Stripe itself is configured and
 * that price's own setting is present; otherwise the pages show "Not yet
 * available" in place of a button.
 *
 * Reported at the grain the pages advertise: a plan lists a monthly and an
 * annual price, and Living Reports lists three token packs, so each of those
 * is answered separately. One configured price must not make its unconfigured
 * siblings look purchasable.
 *
 * Booleans only. Price ids never leave the server through this view, which is
 * why it is safe to serve to a signed-out visitor on the public pricing page.
 */
export interface PlanPeriodAvailability {
  monthly: boolean;
  annual: boolean;
}

export interface PurchaseAvailability {
  plans: {
    pro: PlanPeriodAvailability;
    byok: PlanPeriodAvailability;
  };
  addons: {
    living_report: Record<MonitorTokenPackageId, boolean>;
    reverse_citation_watch: boolean;
  };
}

export function getPurchaseAvailability(): PurchaseAvailability {
  const ids = config.stripe.priceIds;
  // Without the Stripe key every checkout route throws before reaching Stripe,
  // so a price id on its own does not make anything purchasable.
  const stripeReady = Boolean(config.stripe.secretKey.trim());
  const isSet = (value: string | undefined): boolean => stripeReady && Boolean(value && value.trim());
  const packs = new Set(listMonitorTokenPackages().map((p) => p.id));
  const packReady = (id: MonitorTokenPackageId): boolean => stripeReady && packs.has(id);

  return {
    plans: {
      pro: { monthly: isSet(ids.proMonthly), annual: isSet(ids.proAnnual) },
      byok: { monthly: isSet(ids.byokMonthly), annual: isSet(ids.byokAnnual) },
    },
    addons: {
      // Living Reports are bought as monitor token packs (1, 5 or 10 tokens).
      living_report: {
        pack_1: packReady('pack_1'),
        pack_5: packReady('pack_5'),
        pack_10: packReady('pack_10'),
      },
      reverse_citation_watch: isSet(ids.reverseCitationWatchMonthly),
    },
  };
}

/** True when at least one Living Report token pack can be bought. */
export function anyLivingReportPackAvailable(availability: PurchaseAvailability): boolean {
  return Object.values(availability.addons.living_report).some(Boolean);
}
