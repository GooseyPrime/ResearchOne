import { Link, useSearchParams } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

const TOPIC_LABELS: Record<string, string> = {
  investigative: 'Investigative mode — narrative and incentive tracing',
  'general-epistemic': 'General Epistemic — contested evidence balance',
  'anomaly-correlation': 'Anomaly Correlation — weak-signal linkage',
};

export default function SampleReportPage() {
  const [params] = useSearchParams();
  const topic = params.get('topic') ?? '';
  const topicNote = topic ? TOPIC_LABELS[topic] ?? `Topic: ${topic}` : 'Curated excerpt';

  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-r1-accent">{topicNote}</p>
        <h1 className="mt-3 font-serif text-4xl sm:text-5xl">Sample research report</h1>
        <p className="mt-4 text-r1-text-muted">
          Static preview of how ResearchOne preserves disagreement instead of smoothing it into a single narrative.
        </p>

        <div className="mt-10 rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <p className="font-mono text-xs uppercase text-r1-text-muted">Excerpt: hypothetical metabolic question</p>
          <pre className="mt-4 overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-r1-text-muted">{`--- Excerpt: "Effects of Intermittent Fasting on Insulin Sensitivity" ---

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
        </div>

        <Link
          to="/sign-up"
          className="mt-10 inline-flex rounded-md bg-r1-accent px-5 py-3 font-semibold text-r1-bg hover:bg-r1-accent-deep"
        >
          Start your own research →
        </Link>
      </main>
      <LandingFooter />
    </div>
  );
}
