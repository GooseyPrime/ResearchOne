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
const TEAM_MAILTO = 'mailto:hello@researchone.io?subject=Team%20tier%20inquiry';
const PROVENANCE_MAILTO = 'mailto:hello@researchone.io?subject=Provenance%20Ledger%20enterprise%20inquiry';

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
        <p className="mt-4 text-r1-text-muted">Start free. Pay per report. Subscribe when it makes sense. Add monitoring on top of any plan.</p>

        <h2 className="mt-12 font-serif text-3xl">Subscription tiers</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <PricingCard
            title="Free Demo"
            details="$0 — 3 reports lifetime — General Epistemic only — Watermarked"
            cta="Start free"
            to="/sign-up"
          />
          <PricingCard
            title="Student"
            details="$9/mo — 15 Standard + 4 Deep/mo — All 5 modes — Full exports"
            cta="Verify and start"
            to="/sign-up?tier=student"
          />
          <PricingCard
            title="Pro"
            details="$29/mo or $290/yr — 25 reports/mo — All 5 modes — Priority queue — Living Reports available"
            cta="Subscribe"
            to="/sign-up?tier=pro"
            featured
          />
          <PricingCard
            title="BYOK"
            details="$29/mo — Orchestration + exports — Bring your own model keys — Runs billed to your provider"
            cta="Configure keys"
            to="/byok"
          />
          <PricingCard
            title="Team"
            details="$99/seat/mo (3-seat min) — Pooled reports — Shared report library — Audit log — Living Reports available"
            cta="Contact us"
            to={TEAM_MAILTO}
            badge="Coming soon"
          />
          <PricingCard
            title="Sovereign Enterprise"
            details="From $4,500/mo (annual) — dedicated stack and custom retention"
            cta="Talk to sales"
            to="/sovereign"
          />
        </div>

        <h2 id="living-reports" className="mt-12 font-serif text-3xl">Add-ons</h2>
        <p className="mt-2 text-sm text-r1-text-muted">
          Add-ons attach to a finalized report. They require an active Pro, BYOK, Team, or Sovereign subscription. If your tier subscription ends, attached add-ons are cancelled automatically.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <PricingCard
            title="Living Reports"
            details="$19/mo per report — Continuous monitoring of new evidence; auto-revise when something material changes."
            cta="Add to a finalized report"
            to="/app/reports"
          />
          <PricingCard
            title="Reverse-Citation Watch"
            details="$15/mo per report — Get notified when this report or its sources are cited or referenced elsewhere."
            cta="Add to a finalized report"
            to="/app/reports"
          />
          <PricingCard
            title="Provenance Ledger"
            details="Tamper-evident audit trail for every report — SHA-256 signed manifest with public verification endpoint. Required by defense-adjacent and journalism buyers."
            cta="Contact us"
            to={PROVENANCE_MAILTO}
            badge="Coming soon"
          />
          <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
            <h3 className="font-serif text-2xl text-r1-text">Adversarial Twin</h3>
            <p className="mt-3 text-sm leading-7 text-r1-text-muted">
              Dedicated full-attack skeptic that produces only contradictions, gaps, and falsification probes. Included in Sovereign Enterprise.
            </p>
          </article>
        </div>

        <h2 className="mt-12 font-serif text-3xl">Wallet credits</h2>
        <div className="mt-4 rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <p className="text-r1-text-muted">
            Don&apos;t want a subscription? Top up a wallet from $20, $50, or $100 and pay per report: $4 per Standard, $10 per Deep. Wallet credits never expire and overflow Pro/Team monthly caps.
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
