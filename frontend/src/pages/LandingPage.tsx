import { Link } from 'react-router-dom';
import ComparisonTable from '../components/landing/ComparisonTable';
import FAQ from '../components/landing/FAQ';
import Hero from '../components/landing/Hero';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import ModeCard from '../components/landing/ModeCard';
import PipelineDiagram from '../components/landing/PipelineDiagram';
import PricingCard from '../components/landing/PricingCard';

const MODES = [
  {
    mode: 'General Epistemic',
    description: 'Balanced research with evidence tiering and contradiction preservation.',
    example: 'What does the evidence support about [contested topic]?',
  },
  {
    mode: 'Investigative',
    description: 'Track incentives, actor networks, narrative shifts, and bottlenecks.',
    example: 'How did [event] evolve in public reporting over 5 years?',
  },
  {
    mode: 'Patent / Technical Gap',
    description: 'Map prior art, mechanism gaps, and marketable novelty.',
    example: 'Where is the prior art landscape weakest in [technical area]?',
  },
  {
    mode: 'Novel Application Discovery',
    description: 'Explore plausible mechanisms and implementation paths.',
    example: 'What testable applications follow from [emerging finding]?',
  },
  {
    mode: 'Anomaly Correlation',
    description: 'Preserve weak-signal conflicts and rank hypotheses.',
    example: 'Are [observation A] and [observation B] connected?',
  },
];

const FAQ_ITEMS = [
  {
    question: "What's the difference between ResearchOne and Perplexity / ChatGPT Deep Research?",
    answer:
      'ResearchOne uses a 10-stage multi-agent pipeline with a dedicated skeptic agent and explicit evidence tiering. It is optimized for defensible long-form research where contradictions matter.',
  },
  { question: 'How long does a report take?', answer: 'Standard runs: 2-5 minutes. Deep runs: 8-20 minutes based on corpus size and discovery scope.' },
  { question: 'Can I edit a published report?', answer: 'Yes. Every report supports a 7-agent revision workflow with tracked changes.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <Hero />
      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 md:grid-cols-3 sm:px-6">
        <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-5"><h2 className="font-serif text-2xl">Reasoning, not recall.</h2></article>
        <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-5"><h2 className="font-serif text-2xl">Contradictions stay visible.</h2></article>
        <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-5"><h2 className="font-serif text-2xl">Operator-controlled policy.</h2></article>
      </section>
      <ComparisonTable />
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-4 font-serif text-3xl">Ten stages. Seven specialized agents.</h2>
        <PipelineDiagram />
      </section>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">What "contradictions preserved" actually looks like.</h2>
        <pre className="mt-5 overflow-auto rounded-xl border border-white/10 bg-r1-bg-deep p-4 text-xs text-r1-text-muted">{`[strong_evidence] Multiple RCTs show improved fasting insulin [3,7,12]
[contradiction] Three trials report opposite outcomes for women under 40 [9,14,22]
[testimony] Energy and sleep benefits appear in observational studies
[speculation] Autophagy mechanism is plausible but preliminary`}</pre>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-6 font-serif text-3xl">Five modes. Different research, different methodology.</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODES.map((mode) => <ModeCard key={mode.mode} {...mode} />)}
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">Pricing that scales with how seriously you're researching.</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <PricingCard title="Free Demo" details="$0 — 3 reports lifetime — General Epistemic only — Watermarked." cta="Start free" to="/app/research" />
          <PricingCard title="Pro" details="$29/mo or $290/yr — 25 reports/mo — All 5 modes, priority queue — 10 GB corpus." cta="Subscribe" to="/pricing" featured />
          <PricingCard title="Sovereign Enterprise" details="From $4,500/mo (annual) — single tenant deployment and contract isolation." cta="Talk to sales" to="/sovereign" />
        </div>
        <p className="mt-6 text-r1-text-muted">Don't want a subscription? Top up a wallet from $20 and pay per report.</p>
      </section>
      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 md:grid-cols-2 sm:px-6">
        <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <h2 className="font-serif text-3xl">When research can't leave your perimeter.</h2>
          <p className="mt-3 text-r1-text-muted">Single-tenant deployment, dedicated infra, custom retention, and opt-out of global ingestion.</p>
          <Link to="/sovereign" className="mt-4 inline-flex text-r1-accent">Read the sovereign deployment overview →</Link>
        </article>
        <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <h2 className="font-serif text-3xl">Bring your own keys.</h2>
          <p className="mt-3 text-r1-text-muted">Run ResearchOne on your own inference budget with OpenRouter or direct-provider keys.</p>
          <Link to="/byok" className="mt-4 inline-flex text-r1-accent">Configure BYOK →</Link>
        </article>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">Your research, your data.</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-r1-text-muted">
          <li>Server-side model calls only; API keys never reach the browser.</li>
          <li>Per-user isolation with row-level security.</li>
          <li>Encrypted secrets for BYOK credentials.</li>
          <li>Export and delete controls in account settings.</li>
        </ul>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-4 font-serif text-3xl">FAQ</h2>
        <FAQ items={FAQ_ITEMS} />
      </section>
      <LandingFooter />
    </div>
  );
}
