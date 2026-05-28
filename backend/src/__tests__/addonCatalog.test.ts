import { describe, expect, it } from 'vitest';
import { getAddonCatalog } from '../services/billing/addonCatalog';

describe('getAddonCatalog', () => {
  it('includes Stripe-backed report monitors with manage paths', () => {
    const catalog = getAddonCatalog();
    const living = catalog.find((e) => e.id === 'living_report');
    const rcw = catalog.find((e) => e.id === 'reverse_citation_watch');

    expect(living?.billingModel).toBe('report_subscription');
    expect(living?.managePath).toBe('/app/monitors/living-reports');
    expect(rcw?.managePath).toBe('/app/monitors/reverse-citation-watch');
  });

  it('marks deferred platform add-ons as coming soon', () => {
    const catalog = getAddonCatalog();
    expect(catalog.find((e) => e.id === 'provenance_ledger')?.comingSoon).toBe(true);
    expect(catalog.find((e) => e.id === 'score_api_pro')?.comingSoon).toBe(true);
  });
});
