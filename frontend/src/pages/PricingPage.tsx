import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import PricingCard from '../components/landing/PricingCard';

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-5xl">Pricing that scales with how seriously you&apos;re researching.</h1>
        <p className="mt-4 text-r1-text-muted">Start free. Pay per report. Subscribe when it makes sense.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <PricingCard title="Free Demo" details="$0 — 3 reports lifetime — General Epistemic only — Watermarked" cta="Start free" to="/app/research" />
          <PricingCard title="Student" details="$9/mo — 15 Standard + 4 Deep/mo — All 5 modes — Full exports" cta="Verify and start" to="/app/research" />
          <PricingCard title="Pro" details="$29/mo or $290/yr — 25 reports/mo — All 5 modes, priority queue — 10 GB corpus" cta="Subscribe" to="/app/research" featured />
          <PricingCard title="Team" details="$99/seat/mo (3-seat min) — 80 reports/seat pooled — Shared corpus, audit log, SSO" cta="Talk to us" to="/sovereign" />
          <PricingCard title="BYOK" details="$29/mo — All 5 modes, unlimited runs — You bring OpenRouter keys — 25 GB" cta="Configure keys" to="/byok" />
          <PricingCard title="Sovereign Enterprise" details="From $4,500/mo (annual) — dedicated stack and custom retention" cta="Talk to sales" to="/sovereign" />
        </div>
        <div className="mt-8 rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <h2 className="font-serif text-2xl">Wallet credits</h2>
          <p className="mt-2 text-r1-text-muted">
            Don&apos;t want a subscription? Top up a wallet from $20 and pay $4 per Standard report or $10 per Deep report.
          </p>
          <Link to="/app/research" className="mt-4 inline-flex text-r1-accent">Buy credits →</Link>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
