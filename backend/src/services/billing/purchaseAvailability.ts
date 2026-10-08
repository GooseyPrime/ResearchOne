import { config } from '../../config';
import { listMonitorTokenPackages } from './monitorTokenCatalog';

/**
 * Which of the prices shown to a visitor can actually be bought on this
 * deployment. A product is purchasable only when its Stripe price setting is
 * present; otherwise the pages show "Not yet available" in place of a button.
 *
 * Booleans only. Price ids never leave the server through this view, which is
 * why it is safe to serve to a signed-out visitor on the public pricing page.
 */
export interface PurchaseAvailability {
  plans: {
    pro: boolean;
    byok: boolean;
  };
  addons: {
    living_report: boolean;
    reverse_citation_watch: boolean;
  };
}

function isSet(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

export function getPurchaseAvailability(): PurchaseAvailability {
  const ids = config.stripe.priceIds;
  return {
    plans: {
      pro: isSet(ids.proMonthly) || isSet(ids.proAnnual),
      byok: isSet(ids.byokMonthly) || isSet(ids.byokAnnual),
    },
    addons: {
      // Living Reports are bought as monitor token packs (1, 5 or 10 tokens).
      living_report: listMonitorTokenPackages().length > 0,
      reverse_citation_watch: isSet(ids.reverseCitationWatchMonthly),
    },
  };
}
