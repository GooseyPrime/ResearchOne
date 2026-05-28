import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import PricingCard from '../components/landing/PricingCard';
import SubscribeCTA from '../components/billing/SubscribeCTA';

type AddOn = {
  name: string;
  price: string;
  description: string;
  comingSoon?: boolean;
  comingSoonCta?: { label: string; href: string };
};

const ADD_ONS: AddOn[] = [
  {
    name: 'Living Reports',
    price: 'From $10 / token',
    description:
      'Per-report monitor tokens (2 months active per token). Buy 1 for $10, 5 for $25, or 10 for $40 — apply tokens on finalized reports in the app.',
  },
  {
    name: 'Reverse-Citation Watch',
    price: '$15/mo',
    description: 'Get notified when papers, patents, or policy documents cite work that appears in your reports — so you know when your research enters the conversation.',
  },
  {
    name: 'Provenance Ledger',
    price: '$29/mo',
    description: 'Immutable, timestamped audit trail of every source retrieved, every reasoning step taken, and every export generated — suitable for regulatory and legal contexts.',
    comingSoon: true,
    comingSoonCta: {
      label: 'Enterprise inquiry →',
      href: 'mailto:hello@researchone.io?subject=Provenance%20Ledger%20enterprise%20inquiry',
    },
  },
  {
    name: 'Score API Pro',
    price: '$99/mo',
    description: "Programmatic access to ResearchOne's compliance and policy scoring engine. REST API with webhooks, batch scoring, and structured JSON responses.",
  },
  {
    name: 'Patent & IP Diligence',
    price: '$2,500 per engagement',
    description: 'Base floor for patent landscape, freedom-to-operate, and prior art analysis. Delivered as a structured report with cited claim mappings.',
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-5xl">Pricing that scales with how seriously you&apos;re researching.</h1>
        <p className="mt-4 text-r1-text-muted">Start free. Pay per report. Subscribe when it makes sense.</p>

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <PricingCard title="Free Demo" details="$0 — 2 reports lifetime — General Epistemic only — Watermarked" cta="Start free" to="/sign-up" />
          <div id="student" className="contents">
            <PricingCard
              title="Student"
              details="$9/mo — 15 Standard + 4 Deep/mo — All 5 modes — Full exports"
              cta="Verify and start"
              ctaSlot={<SubscribeCTA tier="student" cta="Verify and start" marketingStatic />}
            />
          </div>
          <PricingCard
            title="Pro"
            details="$29/mo or $290/yr — 25 reports/mo — All 5 modes, priority queue — generous corpus quota"
            cta="Subscribe"
            featured
            ctaSlot={<SubscribeCTA tier="pro" cta="Subscribe" featured marketingStatic />}
          />
          <PricingCard
            title="Team"
            badge="Coming soon"
            details="$99/seat/mo (3-seat min) — 80 reports/seat pooled — Team-wide library, audit log, SSO"
            cta="Contact us"
            to="mailto:hello@researchone.io?subject=Team%20tier%20inquiry"
          />
          <PricingCard title="BYOK" details="$29/mo — All 5 modes, unlimited runs — You bring OpenRouter keys — expanded corpus quota" cta="Configure keys" to="/byok" />
          <PricingCard
            title="Sovereign Enterprise"
            details="From $4,500/mo (annual) — dedicated stack and custom retention — Adversarial Twin: Included in Sovereign"
            cta="Talk to sales"
            to="/sovereign"
          />
        </div>

        <div id="living-reports" className="mt-16">
          <h2 className="font-serif text-3xl">Add-ons</h2>
          <p className="mt-2 text-r1-text-muted">
            Add-ons require an active Pro, BYOK, Team, or Sovereign subscription. Available on Pro, Team, and Sovereign. Stack as many as you need.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {ADD_ONS.map((addon) => (
              <article key={addon.name} className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-serif text-xl text-r1-text">{addon.name}</h3>
                  {addon.comingSoon ? (
                    <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-r1-text-muted">
                      Coming soon — Enterprise
                    </span>
                  ) : (
                    <span className="shrink-0 text-sm font-medium text-r1-accent">{addon.price}</span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-7 text-r1-text-muted">{addon.description}</p>
                {addon.comingSoon && addon.comingSoonCta && (
                  <a
                    href={addon.comingSoonCta.href}
                    className="mt-4 inline-flex text-sm text-r1-accent hover:underline"
                  >
                    {addon.comingSoonCta.label}
                  </a>
                )}
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
          All prices are in USD. Annual billing for subscription tiers saves 17%. Nonprofit and journalism teams: contact us for the Team tier discount.
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
