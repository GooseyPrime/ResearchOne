import { config } from '../../config';
import type { MonitorKind } from '../monitoring/parallelMonitorService';

export type AddonBillingModel =
  | 'report_subscription'
  | 'token_pack'
  | 'per_run'
  | 'enterprise_inquiry';

export type AddonCatalogEntry = {
  id: string;
  name: string;
  description: string;
  priceLabel: string;
  billingModel: AddonBillingModel;
  category: 'report_monitor' | 'research_run' | 'platform';
  /** Stripe-backed per-report monitor kind */
  monitorKind?: MonitorKind;
  /** Wallet/run surcharge key from creditEnforcement */
  runAddonKey?: string;
  managePath?: string;
  comingSoon: boolean;
  stripeConfigured: boolean;
  enterpriseMailto?: string;
};

function buildCatalog(): AddonCatalogEntry[] {
  const rcwPrice = Boolean(config.stripe.priceIds.reverseCitationWatchMonthly);

  return [
    {
      id: 'living_report',
      name: 'Living Reports',
      description:
        'Keep a finalized report current with monitor tokens — each token covers one report for two months of Living Report monitoring (same revision pipeline as manual requests).',
      priceLabel: '1 token / 2 months per report',
      billingModel: 'token_pack',
      category: 'report_monitor',
      monitorKind: 'living_report',
      managePath: '/app/billing#monitor-tokens',
      comingSoon: false,
      stripeConfigured: false,
    },
    {
      id: 'reverse_citation_watch',
      name: 'Reverse-Citation Watch',
      description:
        'Get notified when papers, patents, or policy documents cite work that appears in your reports.',
      priceLabel: '$15/mo per report',
      billingModel: 'report_subscription',
      category: 'report_monitor',
      monitorKind: 'reverse_citation_watch',
      managePath: '/app/monitors/reverse-citation-watch',
      comingSoon: false,
      stripeConfigured: rcwPrice,
    },
    // "Devil's Advocate Review" ($5.00 per run) was removed in WO-AH.
    //
    // It sold "a dedicated critique pass on a research run". Every run now gets
    // one, so the add-on was charging for something the product already does.
    // Selling verification back to the customer also implies the unpaid version
    // is the one where nobody checked the work, which is not a claim to make
    // about your own research product.
    //
    // Historical runs may still carry `adversarial_twin` in `selected_addons`.
    // `normalizeRunAddonKeys` filters unknown keys, so those rows read back
    // clean rather than throwing.
    {
      id: 'parallel_search',
      name: 'Parallel Search',
      description: 'Expanded parallel discovery pass during a research run.',
      priceLabel: '+$1.00 per run (wallet)',
      billingModel: 'per_run',
      category: 'research_run',
      runAddonKey: 'parallel_search',
      comingSoon: false,
      stripeConfigured: false,
    },
    {
      id: 'parallel_extract',
      name: 'Parallel Extract',
      description: 'Parallel content extraction for high-volume source sets on a run.',
      priceLabel: '+$1.00 per run (wallet)',
      billingModel: 'per_run',
      category: 'research_run',
      runAddonKey: 'parallel_extract',
      comingSoon: false,
      stripeConfigured: false,
    },
    {
      id: 'smart_citations',
      name: 'Smart Citations',
      description: 'Enhanced citation-and-source chain formatting on a research run.',
      priceLabel: '+$0.50 per run (wallet)',
      billingModel: 'per_run',
      category: 'research_run',
      runAddonKey: 'smart_citations',
      comingSoon: false,
      stripeConfigured: false,
    },
    {
      id: 'provenance_ledger',
      name: 'Provenance Ledger',
      description:
        'Immutable, timestamped audit trail of every source retrieved, reasoning step, and export — suitable for regulatory contexts.',
      priceLabel: '$29/mo',
      billingModel: 'enterprise_inquiry',
      category: 'platform',
      comingSoon: true,
      stripeConfigured: false,
      enterpriseMailto:
        'mailto:hello@researchone.io?subject=Provenance%20Ledger%20enterprise%20inquiry',
    },
    {
      id: 'score_api_pro',
      name: 'Score API Pro',
      description:
        'Programmatic access to ResearchOne compliance and policy scoring — REST API with webhooks and batch scoring.',
      priceLabel: '$99/mo',
      billingModel: 'enterprise_inquiry',
      category: 'platform',
      comingSoon: true,
      stripeConfigured: false,
      enterpriseMailto: 'mailto:hello@researchone.io?subject=Score%20API%20Pro%20inquiry',
    },
    {
      id: 'patent_ip_diligence',
      name: 'Patent & IP Diligence',
      description:
        'Patent landscape, freedom-to-operate, and prior art analysis engagements with cited claim mappings.',
      priceLabel: 'From $2,500 per engagement',
      billingModel: 'enterprise_inquiry',
      category: 'platform',
      comingSoon: true,
      stripeConfigured: false,
      enterpriseMailto: 'mailto:hello@researchone.io?subject=Patent%20%26%20IP%20diligence%20inquiry',
    },
  ];
}

export function getAddonCatalog(): AddonCatalogEntry[] {
  return buildCatalog();
}
