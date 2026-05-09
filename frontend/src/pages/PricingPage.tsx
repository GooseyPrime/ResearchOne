import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import PricingCard from '../components/landing/PricingCard';

const ADD_ONS = [
  {
    name: 'Living Reports',
    price: '$19/mo',
    description: 'Your published reports stay current. ResearchOne monitors the underlying literature and pushes diffs when the evidence meaningfully shifts.',
  },
  {
    name: 'Reverse-Citation Watch',
    price: '$15/mo',
    description: 'Get notified when papers, patents, or policy documents cite work that appears in your reports — so you know when your research enters the conversation.',
  },
  {
    name: 'Adversarial Twin',
    price: '$49/mo',
    description: 'Every report gets a dedicated counter-analysis that actively searches for disconfirming evidence, methodological weaknesses, and alternative interpretations.',
  },
  {
    name: 'Provenance Ledger',
    price: '$29/mo',
    description: 'Immutable, timestamped audit trail of every source retrieved, every reasoning step taken, and every export generated — suitable for regulatory and legal contexts.',
  },
  {
    name: 'Score API Pro',
    price: '$99/mo',
    description: 'Programmatic access to ResearchOne\'s compliance and policy scoring engine. REST API with webhooks, batch scoring, and structured JSON responses.',
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
          <PricingCard title="Free Demo" details="$0 — 3 reports lifetime — General Epistemic only — Watermarked" cta="Start free" to="/sign-up" />
          <PricingCard title="Student" details="$9/mo — 15 Standard + 4 Deep/mo — All 5 modes — Full exports" cta="Verify and start" to="/sign-up?tier=student" />
          <PricingCard title="Pro" details="$29/mo or $290/yr — 25 reports/mo — All 5 modes, priority queue — 10 GB corpus" cta="Subscribe" to="/sign-up?tier=pro" featured />
          <PricingCard title="Team" details="$99/seat/mo (3-seat min) — 80 reports/seat pooled — Shared corpus, audit log, SSO" cta="Talk to us" to="/sovereign" />
          <PricingCard title="BYOK" details="$29/mo — All 5 modes, unlimited runs — You bring OpenRouter keys — 25 GB" cta="Configure keys" to="/byok" />
          <PricingCard title="Sovereign Enterprise" details="From $4,500/mo (annual) — dedicated stack and custom retention" cta="Talk to sales" to="/sovereign" />
        </div>

        <div className="mt-16">
          <h2 className="font-serif text-3xl">Add-ons</h2>
          <p className="mt-2 text-r1-text-muted">Available on Pro, Team, and Sovereign. Stack as many as you need.</p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {ADD_ONS.map((addon) => (
              <article key={addon.name} className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-serif text-xl text-r1-text">{addon.name}</h3>
                  <span className="shrink-0 text-sm font-medium text-r1-accent">{addon.price}</span>
                </div>
                <p className="mt-3 text-sm leading-7 text-r1-text-muted">{addon.description}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-10 rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <h2 className="font-serif text-2xl">Wallet credits</h2>
          <p className="mt-2 text-r1-text-muted">
            Don&apos;t want a subscription? Top up a wallet from $20 and pay $4 per Standard report or $10 per Deep report.
          </p>
          <Link to="/sign-up" className="mt-4 inline-flex text-r1-accent">Buy credits →</Link>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
