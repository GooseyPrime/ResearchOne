import { Link } from 'react-router-dom';
import HeroPipelineVisual from './HeroPipelineVisual';

export default function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:items-center sm:px-6">
      <div className="space-y-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-r1-accent">Built for serious research</p>
        <h1 className="font-serif text-4xl leading-tight text-r1-text sm:text-6xl">
          Deep research that defends itself.
        </h1>
        <p className="max-w-xl text-base text-r1-text-muted sm:text-lg">
          Five deep research modes. A ten-stage multi-agent pipeline with a dedicated skeptic agent.
          Citation-grade reports you can defend in a meeting, a court filing, or a peer review.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/sign-up" className="rounded-md bg-r1-accent px-5 py-3 font-semibold text-r1-bg hover:bg-r1-accent-deep">
            Start free
          </Link>
          <Link to="/sample-report" className="rounded-md border border-white/20 px-5 py-3 font-semibold text-r1-text hover:border-r1-accent">
            See a sample report
          </Link>
        </div>
      </div>
      <HeroPipelineVisual />
    </section>
  );
}
