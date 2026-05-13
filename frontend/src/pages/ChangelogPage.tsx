import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

const ENTRIES = [
  {
    version: 'Wave 2 (in progress)',
    date: '2026-05-12',
    summary:
      'Marquee rebuild: PipelineSchematic hero, LivingReportTimeline, strict FeatureCard caps, §2.10 marketing copy refresh, governance override record.',
  },
  {
    version: '0.9.x',
    date: '2026',
    summary: 'Ongoing pipeline, Living Reports, and tiered evidence model — see methodology for current stage names.',
  },
] as const;

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Changelog</h1>
        <p className="mt-3 text-r1-text-muted">Product-visible changes, newest first.</p>
        <ol className="mt-10 space-y-8 border-l border-white/10 pl-6">
          {ENTRIES.map((e) => (
            <li key={e.version} className="relative">
              <span className="absolute -left-[25px] mt-1.5 h-3 w-3 rounded-full bg-r1-accent" aria-hidden />
              <p className="font-mono text-xs uppercase tracking-wide text-r1-text-muted">
                {e.date} · {e.version}
              </p>
              <p className="mt-2 text-r1-text">{e.summary}</p>
            </li>
          ))}
        </ol>
      </main>
      <LandingFooter />
    </div>
  );
}
