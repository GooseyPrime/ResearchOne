import type { MonitorKind } from '../monitoring/parallelMonitorService';
import { anyLivingReportPackAvailable, getPurchaseAvailability } from './purchaseAvailability';

export type AddonBillingModel =
  | 'report_subscription'
  | 'token_pack'
  | 'per_run'
  | 'inquiry';

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
  inquiryMailto?: string;
};

function buildCatalog(): AddonCatalogEntry[] {
  const availability = getPurchaseAvailability();
  const rcwPrice = availability.addons.reverse_citation_watch;
  // Living Reports are sold as token packs: purchasable when at least one pack
  // has its Stripe price set. This was hard-coded to false, so the catalog
  // could not tell a configured deployment from an unconfigured one.
  const livingReportTokens = anyLivingReportPackAvailable(availability);

  return [
    {
      id: 'living_report',
      name: 'Living Reports',
      description:
        'Keeps a finished report up to date: when new sources change the picture, the report is revised for you.',
      priceLabel: '1 token / 2 months per report',
      billingModel: 'token_pack',
      category: 'report_monitor',
      monitorKind: 'living_report',
      managePath: '/app/billing#monitor-tokens',
      comingSoon: false,
      stripeConfigured: livingReportTokens,
    },
    {
      id: 'reverse_citation_watch',
      name: 'Reverse-Citation Watch',
      description:
        'Tells you when a paper, patent or policy document cites work that appears in your report.',
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
      description:
        'Lets one research run read more newly found sources than usual before it writes.',
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
      description:
        'Gathers more passages from the sources on one run, so the report draws on more of what was read.',
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
      description:
        'Matches each citation against twice as many passages on one run, so citations point to the right source more often.',
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
        'Keeps a dated record of every source read, every step taken and every export made, which cannot be edited afterwards.',
      priceLabel: '$29/mo',
      billingModel: 'inquiry',
      category: 'platform',
      comingSoon: true,
      stripeConfigured: false,
      inquiryMailto:
        'mailto:hello@researchone.io?subject=Provenance%20Ledger%20inquiry',
    },
    {
      id: 'score_api_pro',
      name: 'Score API Pro',
      description:
        'Lets your own software send documents to ResearchOne for compliance and policy scoring.',
      priceLabel: '$99/mo',
      billingModel: 'inquiry',
      category: 'platform',
      comingSoon: true,
      stripeConfigured: false,
      inquiryMailto: 'mailto:hello@researchone.io?subject=Score%20API%20Pro%20inquiry',
    },
    {
      id: 'patent_ip_diligence',
      name: 'Patent & IP Diligence',
      description:
        'A commissioned study of the patents around your product: what exists, what you may use, and earlier inventions.',
      priceLabel: 'From $2,500 per engagement',
      billingModel: 'inquiry',
      category: 'platform',
      comingSoon: true,
      stripeConfigured: false,
      inquiryMailto: 'mailto:hello@researchone.io?subject=Patent%20%26%20IP%20diligence%20inquiry',
    },
  ];
}

export function getAddonCatalog(): AddonCatalogEntry[] {
  return buildCatalog();
}
