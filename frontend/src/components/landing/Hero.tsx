import { Link } from 'react-router-dom';
import HeroPipelineVisual from './HeroPipelineVisual';

export default function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:items-center sm:px-6">
      <div className="space-y-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-r1-accent">DEEP RESEARCH PLATFORM</p>
        <h1 className="font-serif text-4xl leading-tight text-r1-text sm:text-6xl">Deep research that adapts to the question.</h1>
        <p className="max-w-xl text-base text-r1-text-muted sm:text-lg">
          Ask for an explanation, comparison, evidence review, opportunity map, implementation plan, or claim
          verification. ResearchOne builds a plan, gathers sources, selects the right specialists, and produces a cited
          report with uncertainty and contradictions made visible.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/sample-report" className="rounded-md bg-r1-accent px-5 py-3 font-semibold text-r1-bg hover:bg-r1-accent-deep">
            Open a sample report
          </Link>
          <Link to="/methodology" className="rounded-md border border-white/20 px-5 py-3 font-semibold text-r1-text hover:border-r1-accent">
            See the methodology
          </Link>
        </div>
      </div>
      <HeroPipelineVisual />
    </section>
  );
}
