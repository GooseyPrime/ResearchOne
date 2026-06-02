import { config } from '../../config';
import type { MonitorKind } from '../monitoring/parallelMonitorService';

export type AddonBillingModel =
  | 'report_subscription'
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
  const livingPrice = Boolean(config.stripe.priceIds.livingReportMonthly);
  const rcwPrice = Boolean(config.stripe.priceIds.reverseCitationWatchMonthly);

  return [
    {
      id: 'living_report',
      name: 'Living Reports',
      description:
        'Your published reports stay current. ResearchOne monitors the underlying literature and pushes diffs when the sources meaningfully shift.',
      priceLabel: '$19/mo per report',
      billingModel: 'report_subscription',
      category: 'report_monitor',
      monitorKind: 'living_report',
      managePath: '/app/monitors/living-reports',
      comingSoon: false,
      stripeConfigured: livingPrice,
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
    {
      id: 'adversarial_twin',
      name: "Devil's Advocate Review",
      description:
        'A dedicated critique pass on a research run — flags contradictions, unsupported claims, reasoning gaps, and exact passages that need attention. Extra wallet surcharge when your tier does not include it.',
      priceLabel: '+$5.00 per run (wallet)',
      billingModel: 'per_run',
      category: 'research_run',
      runAddonKey: 'adversarial_twin',
      comingSoon: false,
      stripeConfigured: false,
    },
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
