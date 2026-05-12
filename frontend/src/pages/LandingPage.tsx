import { Link } from 'react-router-dom';
import ComparisonTable from '../components/landing/ComparisonTable';
import EvidenceProvenancePanel from '../components/landing/EvidenceProvenancePanel';
import FAQ from '../components/landing/FAQ';
import FinalCTA from '../components/landing/FinalCTA';
import PersonaAwareHero from '../components/landing/persona/PersonaAwareHero';
import LabNotebookCanvas from '../components/landing/visual/LabNotebookCanvas';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import LivingReportsSection from '../components/landing/LivingReportsSection';
import ModeCard from '../components/landing/ModeCard';
import PipelineDiagram from '../components/landing/PipelineDiagram';
import PricingCard from '../components/landing/PricingCard';
import WhyResearchOne from '../components/landing/WhyResearchOne';
import api from '../utils/api';

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
    question: "What's the difference between ResearchOne and chat-style AI research?",
    answer:
      'Chat-style tools optimize for fast cited answers. ResearchOne uses a ten-stage multi-agent pipeline with a dedicated skeptic agent and explicit evidence tiering, optimized for defensible long-form reports where contradictions matter and the output needs to outlive the conversation.',
  },
  {
    question: 'Which deep research mode should I use?',
    answer:
      'General Epistemic for contested questions. Investigative for tracking incentives or narrative drift. Patent / Technical Gap for prior-art mapping. Novel Application Discovery for mechanism-to-application paths. Anomaly Correlation for weak-signal hypothesis testing.',
  },
  {
    question: 'How long does a report take?',
    answer: 'Standard runs: 2–5 minutes. Deep runs: 8–20 minutes depending on mode, evidence-set size, and discovery scope.',
  },
  {
    question: 'What happens to my report after 120 days?',
    answer:
      'Final reports are retained for 120 days by default. Export anytime, or attach a Living Report to keep the source set and monitoring config alive indefinitely. Sovereign Enterprise customers set custom retention by contract.',
  },
  {
    question: 'How does ResearchOne handle citations and source verification?',
    answer:
      'Every claim is tagged by evidence tier (established fact, strong evidence, testimony, inference, speculation). Every source is selected for a role — supporting, contrasting, primary, or regulatory — and recorded with inclusion reasoning. The Verifier agent gates publication on citation integrity.',
  },
  {
    question: 'Can I edit a published report?',
    answer:
      'Yes. Every report supports a seven-agent revision workflow with structured intake, impact mapping, change planning, section rewriting, citation integrity checks, diff assembly, and a final verifier.',
  },
  {
    question: 'Can I bring my own model keys?',
    answer:
      'Yes. The BYOK tier lets you run all five modes on your own OpenRouter or direct-provider keys. Compute is billed to your provider; ResearchOne bills only for orchestration.',
  },
  {
    question: 'Is my data used to train any models?',
    answer:
      'No. ResearchOne does not train on customer research data. BYOK and Sovereign Enterprise tiers add additional contractual data-use guarantees.',
  },
];

export default function LandingPage() {
  return (
    <LabNotebookCanvas className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />

      <PersonaAwareHero
        onPersonaResolved={(persona, path) => {
          api.post('/landing/persona-event', { persona, path, eventType: 'view' }).catch(() => {});
        }}
      />

      <WhyResearchOne />

      <ComparisonTable />

      {/* Five modes section */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-2 font-serif text-3xl">Five modes. Different research, different methodology.</h2>
        <p className="mb-6 text-r1-text-muted">Choose your depth before you choose your deadline.</p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODES.map((mode) => <ModeCard key={mode.mode} {...mode} />)}
        </div>
        <p className="mt-6 text-sm">
          <Link to="/methodology#modes" className="text-r1-accent hover:underline">
            See how the modes compare →
          </Link>
        </p>
      </section>

      <LivingReportsSection />

      {/* Pipeline section */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-4 font-serif text-3xl">Ten stages. Seven specialized agents.</h2>
        <p className="mb-2 font-mono text-sm text-r1-accent">Plan it. Read it. Cross-check it. Cite it.</p>
        <p className="mb-6 text-r1-text-muted">
          Every report follows the same disciplined ten-stage pipeline. You see it run live as it happens.
        </p>
        <PipelineDiagram />
        <p className="mt-6 text-sm text-r1-text-muted">
          Want to revise a published report? Every report supports a 7-agent revision workflow.{' '}
          <Link to="/methodology" className="text-r1-accent hover:underline">
            Read the methodology →
          </Link>
        </p>
      </section>

      {/* Contradictions excerpt */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">Every claim has a tier. Every contradiction has a name.</h2>
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

      <EvidenceProvenancePanel />

      {/* Sample reports */}
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

      {/* Pricing teaser */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">Pricing that scales with how seriously you&apos;re researching.</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <PricingCard title="Free Demo" details="$0 — 3 reports lifetime — General Epistemic only — Watermarked." cta="Start free" to="/sign-up" />
          <PricingCard title="Pro" details="$29/mo or $290/yr — 25 reports/mo — All 5 modes — Priority queue — Living Reports available." cta="Subscribe" to="/sign-up?tier=pro" featured />
          <PricingCard title="BYOK" details="$29/mo — Orchestration + exports — Bring your own model keys — Runs billed to your provider." cta="Configure keys" to="/byok" />
          <PricingCard title="Sovereign Enterprise" details="From $4,500/mo (annual) — single tenant deployment and contract isolation." cta="Talk to sales" to="/sovereign" />
        </div>
        <p className="mt-6 text-r1-text-muted">
          Plus add-ons: Living Reports ($19/mo), Reverse-Citation Watch ($15/mo), and wallet credits from $20.{' '}
          <Link to="/pricing" className="text-r1-accent">See full pricing →</Link>
        </p>
      </section>

      {/* Sovereign + BYOK */}
      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 md:grid-cols-2 sm:px-6">
        <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <h2 className="font-serif text-3xl">When research can&apos;t leave your perimeter.</h2>
          <p className="mt-3 text-r1-text-muted">Single-tenant deployment, dedicated infra, custom retention, and opt-out of global ingestion.</p>
          <Link to="/sovereign" className="mt-4 inline-flex text-r1-accent">Read the sovereign deployment overview →</Link>
        </article>
        <article className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <h2 className="font-serif text-3xl">Bring your own keys.</h2>
          <p className="mt-3 text-r1-text-muted">Run ResearchOne on your own inference budget with OpenRouter or direct-provider keys.</p>
          <Link to="/byok" className="mt-4 inline-flex text-r1-accent">Configure BYOK →</Link>
        </article>
      </section>

      {/* Security / privacy */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">Your research, your data, your audit trail.</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-r1-text-muted">
          <li>Server-side model calls only; API keys never reach the browser.</li>
          <li>Per-user isolation with row-level security.</li>
          <li>Encrypted secrets for BYOK credentials.</li>
          <li>Export and delete controls in account settings.</li>
          <li>Per-mode, per-source, per-revision audit log on every report.</li>
        </ul>
      </section>

      <FinalCTA />

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-4 font-serif text-3xl">FAQ</h2>
        <FAQ items={FAQ_ITEMS} />
      </section>

      <LandingFooter />
    </LabNotebookCanvas>
  );
}
