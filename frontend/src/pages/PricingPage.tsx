import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import PricingCard from '../components/landing/PricingCard';
import SubscribeCTA from '../components/billing/SubscribeCTA';
import NotYetAvailable from '../components/billing/NotYetAvailable';
import {
  addonUnavailable,
  planUnavailable,
  unavailablePlanPeriods,
  unavailableTokenPacks,
  usePricingVisitorState,
  type BillingPeriod,
  type PurchasableAddon,
} from '../lib/billing/availability';

type AddOn = {
  name: string;
  price: string;
  description: string;
  comingSoon?: boolean;
  /**
   * Where a subscriber buys it. Both targets are inside the app: a signed-out
   * visitor is sent to sign in and brought back, and the server checks the
   * plan again before anything is sold.
   */
  buy?: { addon: PurchasableAddon; label: string; to: string };
  /** Priced, but not sold through checkout: shown as not yet available, with a way to ask. */
  inquiry?: { label: string; href: string };
};

const ADD_ONS: AddOn[] = [
  {
    name: 'Living Reports',
    price: 'From $10 / token',
    description:
      'Per-report monitor tokens (2 months active per token). Buy 1 for $10, 5 for $25, or 10 for $40 — apply tokens on finalized reports in the app.',
    buy: { addon: 'living_report', label: 'Buy tokens', to: '/app/billing#monitor-tokens' },
  },
  {
    name: 'Reverse-Citation Watch',
    price: '$15/mo',
    description: 'Get notified when papers, patents, or policy documents cite work that appears in your reports — so you know when your research enters the conversation.',
    buy: { addon: 'reverse_citation_watch', label: 'Add to a report', to: '/app/add-ons' },
  },
  {
    name: 'Provenance Ledger',
    price: '$29/mo',
    description: 'Immutable, timestamped audit trail of every source retrieved, every reasoning step taken, and every export generated — suitable for regulatory and legal contexts.',
    comingSoon: true,
  },
  {
    name: 'Score API Pro',
    price: '$99/mo',
    description: "Programmatic access to ResearchOne's compliance and policy scoring engine. REST API with webhooks, batch scoring, and structured JSON responses.",
    inquiry: { label: 'Ask about Score API Pro →', href: 'mailto:hello@researchone.io?subject=Score%20API%20Pro%20inquiry' },
  },
  {
    name: 'Patent & IP Diligence',
    price: '$2,500 per engagement',
    description: 'Base floor for patent landscape, freedom-to-operate, and prior art analysis. Delivered as a structured report with cited patent mappings.',
    inquiry: {
      label: 'Ask about an engagement →',
      href: 'mailto:hello@researchone.io?subject=Patent%20%26%20IP%20diligence%20inquiry',
    },
  },
];

const PERIOD_LABEL: Record<BillingPeriod, string> = {
  monthly: 'Monthly billing',
  annual: 'Annual billing',
};

const BUY_LINK_CLASS =
  'mt-4 inline-flex rounded-md bg-r1-accent px-3 py-2 text-sm font-semibold text-r1-bg transition hover:bg-r1-accent-deep';

export default function PricingPage() {
  // Unknown until the browser has asked the server; until then every buy link
  // is shown (see planUnavailable for why that is never a dead end).
  const { availability, signedIn } = usePricingVisitorState();
  const proUnavailable = planUnavailable(availability, 'pro');
  const byokUnavailable = planUnavailable(availability, 'byok');
  // Each card quotes specific prices; a quoted price that cannot be bought is
  // named, even when the plan or add-on as a whole still can be.
  const proMissingPeriods = unavailablePlanPeriods(availability, 'pro', ['monthly', 'annual']);
  const byokMissingPeriods = unavailablePlanPeriods(availability, 'byok', ['monthly']);
  const missingTokenPacks = unavailableTokenPacks(availability);

  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-5xl">Pricing that scales with how seriously you&apos;re researching.</h1>
        <p className="mt-4 text-r1-text-muted">Start free. Pay per report. Subscribe when it makes sense.</p>

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <PricingCard title="Free Demo" details="$0 — 2 reports lifetime — General Research only — Watermarked" cta="Start free" to="/sign-up" />
          <div id="student" className="contents">
            <PricingCard
              title="Student"
              badge="Coming soon"
              comingSoon
              details="$9/mo — 15 Standard + 4 Deep/mo — All 5 modes — Full exports"
              cta="Coming soon"
            />
          </div>
          <PricingCard
            title="Pro"
            details="$29/mo or $290/yr — 25 reports/mo — All 5 modes — Private corpus (Ingest workspace) + Atlas"
            cta="Subscribe"
            featured
            comingSoon={proUnavailable}
            ctaSlot={
              <div>
                <SubscribeCTA tier="pro" cta="Subscribe" marketingStatic signedIn={signedIn} />
                {proMissingPeriods.map((period) => (
                  <NotYetAvailable key={period} tone="marketing" className="mt-3" subject={PERIOD_LABEL[period]} />
                ))}
              </div>
            }
          />
          <PricingCard
            title="BYOK"
            details="$29/mo — All 5 modes, unlimited runs — BYOK keys — Private corpus (Ingest)"
            cta="Subscribe"
            comingSoon={byokUnavailable}
            ctaSlot={
              <div>
                <SubscribeCTA tier="byok" cta="Subscribe" marketingStatic signedIn={signedIn} />
                {byokMissingPeriods.map((period) => (
                  <NotYetAvailable key={period} tone="marketing" className="mt-3" subject={PERIOD_LABEL[period]} />
                ))}
                <p className="mt-3 text-xs text-r1-text-muted">
                  You add your model keys right after checkout.{' '}
                  <Link to="/byok" className="text-r1-accent hover:underline">
                    How BYOK works
                  </Link>
                </p>
              </div>
            }
          />
        </div>

        <div id="living-reports" className="mt-16">
          <h2 className="font-serif text-3xl">Add-ons</h2>
          <p className="mt-2 text-r1-text-muted">
            Add-ons require an active Pro or BYOK subscription. Stack as many as you need.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {ADD_ONS.map((addon) => (
              <article key={addon.name} className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-serif text-xl text-r1-text">{addon.name}</h3>
                  {addon.comingSoon ? (
                    <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-r1-text-muted">
                      Coming soon
                    </span>
                  ) : (
                    <span className="shrink-0 text-sm font-medium text-r1-accent">{addon.price}</span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-7 text-r1-text-muted">{addon.description}</p>
                {addon.buy ? (
                  addonUnavailable(availability, addon.buy.addon) ? (
                    <NotYetAvailable tone="marketing" className="mt-4" />
                  ) : (
                    <div>
                      <Link to={addon.buy.to} className={BUY_LINK_CLASS} data-addon-buy={addon.buy.addon}>
                        {addon.buy.label}
                      </Link>
                      {addon.buy.addon === 'living_report'
                        ? missingTokenPacks.map((pack) => (
                            <NotYetAvailable key={pack} tone="marketing" className="mt-3" subject={pack} />
                          ))
                        : null}
                    </div>
                  )
                ) : null}
                {addon.inquiry ? (
                  <div className="mt-4">
                    <NotYetAvailable tone="marketing" />
                    <a href={addon.inquiry.href} className="mt-2 inline-flex text-sm text-r1-accent hover:underline">
                      {addon.inquiry.label}
                    </a>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>

        <div className="mt-10 rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <h2 className="font-serif text-2xl">Wallet credits</h2>
          <p className="mt-2 text-r1-text-muted">
            Don&apos;t want a subscription? Top up a wallet from $20 ($50 and $100 presets available) and pay $4 per Standard report or $10 per Deep report.
          </p>
          <Link to="/sign-up" className="mt-4 inline-flex text-r1-accent">Start with a wallet →</Link>
        </div>

        <p className="mt-12 text-xs text-r1-text-muted">
          All prices are in USD. Annual billing for available subscription tiers saves 17%.
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
