import { Link } from 'react-router-dom';
import ComparisonTable from '../components/landing/ComparisonTable';
import FAQ from '../components/landing/FAQ';
import Hero from '../components/landing/Hero';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import ModeCard from '../components/landing/ModeCard';
import PipelineDiagram from '../components/landing/PipelineDiagram';
import PricingCard from '../components/landing/PricingCard';

const SAMPLE_REPORTS = [
  {
    slug: 'investigative',
    mode: 'Investigative',
    title: 'How reporting shifted over five years',
    summary: 'Trace incentives, bottlenecks, and narrative drift on a contested timeline.',
  },
  {
    slug: 'general-epistemic',
    mode: 'General Epistemic',
    title: 'What the evidence supports on a disputed claim',
    summary: 'Balanced synthesis with explicit tiers — no forced consensus.',
  },
  {
    slug: 'anomaly-correlation',
    mode: 'Anomaly Correlation',
    title: 'Are two weak signals the same phenomenon?',
    summary: 'Map correlations while keeping contradictions visible.',
  },
] as const;

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
        <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-5">
          <h2 className="font-serif text-2xl">Reasoning, not recall.</h2>
          <p className="mt-3 text-sm leading-relaxed text-r1-text-muted">
            Most AI tools collapse a question into top-k retrieval and a single-model summary. ResearchOne plans the
            investigation, retrieves evidence, reasons through it, and routes a dedicated skeptic agent to attack its own
            conclusions. The reasoning trace is auditable end-to-end.
          </p>
        </article>
        <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-5">
          <h2 className="font-serif text-2xl">Contradictions stay visible.</h2>
          <p className="mt-3 text-sm leading-relaxed text-r1-text-muted">
            When sources disagree, polished summaries hide it. ResearchOne tags every claim by evidence tier — established
            fact, strong evidence, testimony, inference, speculation — and surfaces contradictions as first-class outputs
            rather than smoothing them into consensus.
          </p>
        </article>
        <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-5">
          <h2 className="font-serif text-2xl">Operator-controlled policy.</h2>
          <p className="mt-3 text-sm leading-relaxed text-r1-text-muted">
            You decide which models reason on your research. Standard mode runs on production-grade models for everyday
            work. Deeper modes route through open-weight reasoning ensembles for queries where alignment behavior matters.
            Bring your own keys when you want full control.
          </p>
        </article>
      </section>
      <ComparisonTable />
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-4 font-serif text-3xl">Ten stages. Seven specialized agents.</h2>
        <p className="mb-6 text-r1-text-muted">
          Every report follows the same disciplined pipeline. You see it run live as it happens.
        </p>
        <PipelineDiagram />
        <p className="mt-6 text-sm text-r1-text-muted">
          Want to revise a published report? Every report supports a 7-agent revision workflow.{' '}
          <Link to="/methodology" className="text-r1-accent hover:underline">
            Read the methodology →
          </Link>
        </p>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">What &quot;contradictions preserved&quot; actually looks like.</h2>
        <p className="mt-3 text-r1-text-muted">
          Most tools sand contested findings into a clean narrative. ResearchOne names them.
        </p>
        <pre className="mt-5 overflow-auto rounded-xl border border-white/10 bg-r1-bg-deep p-4 text-xs text-r1-text-muted">{`--- Excerpt: "Effects of Intermittent Fasting on Insulin Sensitivity" ---

[strong_evidence]  Multiple RCTs show improved fasting insulin
                   in metabolically unhealthy adults [3, 7, 12].

[contradiction]    Three trials reaching opposite conclusions on
                   women under 40 [9, 14, 22] — protocol differences
                   in fasting window length appear material.

[testimony]        Self-reported energy and sleep quality benefits
                   appear consistently in observational studies but
                   are not isolated from selection effects.

[speculation]      Mechanism via autophagy upregulation is plausible
                   but human-trial evidence is preliminary.`}</pre>
        <p className="mt-4 text-sm text-r1-text-muted">
          Every claim carries its tier. Every contradiction has a name. The reader does the final judgment work.
        </p>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-6 font-serif text-3xl">Five modes. Different research, different methodology.</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODES.map((mode) => <ModeCard key={mode.mode} {...mode} />)}
        </div>
        <p className="mt-6 text-sm text-r1-text-muted">
          Each mode runs the full 10-stage pipeline with mode-specific overlays on the planner, skeptic, and synthesizer.
        </p>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">See it on a real question.</h2>
        <p className="mt-3 text-r1-text-muted">Three sample reports, varied in topic and mode.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {SAMPLE_REPORTS.map((r) => (
            <Link
              key={r.slug}
              to={`/sample-report?topic=${r.slug}`}
              className="rounded-xl border border-white/10 bg-r1-bg-deep p-5 transition hover:border-r1-accent/50 hover:bg-r1-bg"
            >
              <p className="font-mono text-xs uppercase text-r1-accent">{r.mode}</p>
              <h3 className="mt-2 font-serif text-xl">{r.title}</h3>
              <p className="mt-2 text-sm text-r1-text-muted">{r.summary}</p>
            </Link>
          ))}
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">Pricing that scales with how seriously you're researching.</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <PricingCard title="Free Demo" details="$0 — 3 reports lifetime — General Epistemic only — Watermarked." cta="Start free" to="/sign-up" />
          <PricingCard title="Pro" details="$29/mo or $290/yr — 25 reports/mo — All 5 modes, priority queue — 10 GB corpus." cta="Subscribe" to="/sign-up?tier=pro" featured />
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
