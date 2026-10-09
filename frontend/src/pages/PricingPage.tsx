import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import PricingCard from '../components/landing/PricingCard';
import SubscribeCTA from '../components/billing/SubscribeCTA';
import NotYetAvailable from '../components/billing/NotYetAvailable';
import { customerOption, customerOptionHelp, customerOptionsIn } from '../content/customerOptions';
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
  /** The add-on's id in the registry of customer-facing names, where its name, description and example are written. */
  id: string;
  price: string;
  /** How it is priced and bought. What it does is in the registry. */
  pricing?: string;
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
    id: 'living_report',
    price: 'From $10 / token',
    pricing:
      'One token keeps one report up to date for two months. Buy 1 for $10, 5 for $25, or 10 for $40 — apply tokens on finalized reports in the app.',
    buy: { addon: 'living_report', label: 'Buy tokens', to: '/app/billing#monitor-tokens' },
  },
  {
    id: 'reverse_citation_watch',
    price: '$15/mo',
    buy: { addon: 'reverse_citation_watch', label: 'Add to a report', to: '/app/add-ons' },
  },
  {
    id: 'provenance_ledger',
    price: '$29/mo',
    comingSoon: true,
  },
  {
    id: 'score_api_pro',
    price: '$99/mo',
    inquiry: { label: 'Ask about Score API Pro →', href: 'mailto:hello@researchone.io?subject=Score%20API%20Pro%20inquiry' },
  },
  {
    id: 'patent_ip_diligence',
    price: '$2,500 per engagement',
    pricing: 'The price is the starting point for one engagement, delivered as a report with each patent cited.',
    inquiry: {
      label: 'Ask about an engagement →',
      href: 'mailto:hello@researchone.io?subject=Patent%20%26%20IP%20diligence%20inquiry',
    },
  },
];

/** Plans, named and described from the registry of customer-facing names. */
const PLAN = Object.fromEntries(customerOptionsIn('plan').map((option) => [option.id, option]));

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
          <PricingCard title={PLAN.free_demo.name} about={customerOptionHelp(PLAN.free_demo)} details="$0 — 2 reports lifetime — General Research only — Watermarked" cta="Start free" to="/sign-up" />
          <div id="student" className="contents">
            <PricingCard
              title={PLAN.student.name}
              about={customerOptionHelp(PLAN.student)}
              badge="Coming soon"
              comingSoon
              details="$9/mo — 15 Standard + 4 Deep/mo — All 5 modes — Full exports"
              cta="Coming soon"
            />
          </div>
          <PricingCard
            title={PLAN.pro.name}
            about={customerOptionHelp(PLAN.pro)}
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
            title={PLAN.byok.name}
            about={customerOptionHelp(PLAN.byok)}
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
            {ADD_ONS.map((addon) => {
              const words = customerOption('add_on', addon.id);
              return (
              <article key={addon.id} className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-serif text-xl text-r1-text">{words.name}</h3>
                  {addon.comingSoon ? (
                    <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-r1-text-muted">
                      Coming soon
                    </span>
                  ) : (
                    <span className="shrink-0 text-sm font-medium text-r1-accent">{addon.price}</span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-7 text-r1-text-muted">{customerOptionHelp(words)}</p>
                {addon.pricing ? <p className="mt-2 text-sm leading-7 text-r1-text-muted">{addon.pricing}</p> : null}
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
              );
            })}
          </div>
        </div>

        <div className="mt-10 rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <h2 className="font-serif text-2xl">{PLAN.wallet.name}</h2>
          <p className="mt-2 text-r1-text-muted">{customerOptionHelp(PLAN.wallet)}</p>
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
