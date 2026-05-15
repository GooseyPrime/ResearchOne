import { useCallback, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import ComparisonTable from '../components/landing/ComparisonTable';
import SourceProvenancePanel from '../components/landing/SourceProvenancePanel';
import FAQ from '../components/landing/FAQ';
import FeatureCard from '../components/landing/FeatureCard';
import FinalCTA from '../components/landing/FinalCTA';
import PersonaAwareHero from '../components/landing/persona/PersonaAwareHero';
import type { PersonaId } from '../components/landing/persona/personaResolver';
import { MARKETING_SLATE_DEPTH_LAYERS } from '../components/landing/marketingSlateDepth';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import LivingReportsSection from '../components/landing/LivingReportsSection';
import ModeCard from '../components/landing/ModeCard';
import PricingCard from '../components/landing/PricingCard';
import { LANDING_SIX_FEATURE_CARDS } from '../content/landingFeatureCards';
import { MARKETING_FAQ_ITEMS } from '../content/marketingFaqItems';
import { publicApi } from '../utils/api';

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
    title: 'What the sources support on a disputed claim',
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
    description: 'Balanced research with source-corroboration tiering and contradiction preservation.',
    example: 'What do the sources support about [contested topic]?',
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

const landingSlateShellStyle = MARKETING_SLATE_DEPTH_LAYERS as CSSProperties;

export default function LandingPage() {
  const personaBeaconDedupeRef = useRef<{ key: string; at: number } | null>(null);
  const onPersonaResolved = useCallback((persona: PersonaId, path: string) => {
    const now = Date.now();
    const key = `${persona}\0${path}`;
    const prev = personaBeaconDedupeRef.current;
    if (prev && prev.key === key && now - prev.at < 800) return;
    personaBeaconDedupeRef.current = { key, at: now };
    void publicApi
      .post('/landing/persona-event', { persona, path, eventType: 'view' })
      .catch(() => {});
  }, []);

  return (
    <div className="relative isolate min-h-screen overflow-x-hidden bg-slate-950 text-r1-text">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={landingSlateShellStyle}
      />
      <div className="relative z-10 min-h-screen">
      <LandingHeader />

      <main id="marketing-main">
      <div data-testid="landing-hero-region">
        <PersonaAwareHero onPersonaResolved={onPersonaResolved} />
      </div>

      <section
        data-testid="landing-feature-cards"
        className="mx-auto max-w-6xl px-4 py-16 sm:px-6"
        aria-labelledby="landing-feature-cards-heading"
      >
        <h2 id="landing-feature-cards-heading" className="sr-only">
          What ResearchOne delivers
        </h2>
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LANDING_SIX_FEATURE_CARDS.map((card) => (
            <FeatureCard key={card.headline} {...card} />
          ))}
        </div>
      </section>

      <div data-testid="landing-comparison-region">
        <ComparisonTable />
      </div>

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

      <div data-testid="landing-living-report-region">
        <LivingReportsSection />
      </div>

      {/* Methodology teaser — site audit §2.10 */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">Ten stages. Seven agents. One adversary.</h2>
        <p className="mt-3 max-w-3xl text-r1-text-muted">
          Intake to Living state, every step is named, instrumented, and reviewable.
        </p>
        <p className="mt-6">
          <Link to="/methodology" className="text-r1-accent hover:underline">
            Walk the pipeline →
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
                   but human-trial findings remain preliminary.`}</pre>
        <p className="mt-4 text-sm text-r1-text-muted">
          Every claim carries its tier. Every contradiction has a name. The reader does the final judgment work.
        </p>
      </section>

      <SourceProvenancePanel />

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

      {/* Security teaser — site audit §3.8.1 (H1/sub from §2.10 Security / Trust) */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-serif text-3xl">Defensible at the data layer, too.</h2>
        <p className="mt-3 max-w-3xl text-r1-text-muted">
          BYOK by default, sovereign-tier tenancy on request, full audit log on every report.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/15 bg-r1-bg-deep px-3 py-1.5 text-xs font-medium text-r1-text">
            BYOK by default
          </span>
          <span className="rounded-full border border-white/15 bg-r1-bg-deep px-3 py-1.5 text-xs font-medium text-r1-text">
            Sovereign tenancy on request
          </span>
          <span className="rounded-full border border-white/15 bg-r1-bg-deep px-3 py-1.5 text-xs font-medium text-r1-text">
            Per-report audit log
          </span>
        </div>
        <p className="mt-6">
          <Link to="/security" className="text-r1-accent hover:underline">
            See trust posture →
          </Link>
        </p>
      </section>

      <FinalCTA />

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="mb-4 font-serif text-3xl">FAQ</h2>
        <FAQ items={MARKETING_FAQ_ITEMS} />
      </section>
      </main>

      <LandingFooter />
      </div>
    </div>
  );
}
