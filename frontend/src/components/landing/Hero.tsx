import { Link } from 'react-router-dom';

export default function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:items-center sm:px-6">
      <div className="space-y-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-r1-accent">Built for serious research</p>
        <h1 className="font-serif text-4xl leading-tight text-r1-text sm:text-6xl">Research that shows its work.</h1>
        <p className="max-w-xl text-base text-r1-text-muted sm:text-lg">
          ResearchOne is a multi-agent research platform that plans, retrieves, reasons, and challenges its own
          conclusions before it answers.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/app/research" className="rounded-md bg-r1-accent px-5 py-3 font-semibold text-r1-bg hover:bg-r1-accent-deep">
            Start free
          </Link>
          <Link to="/app/reports" className="rounded-md border border-white/20 px-5 py-3 font-semibold text-r1-text hover:border-r1-accent">
            See a sample report
          </Link>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
        <p className="mb-4 text-sm text-r1-text-muted">10 stages. 7 specialized agents. One report.</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {['Planner', 'Discovery', 'Retriever', 'Analysis', 'Reasoner', 'Skeptic', 'Synthesizer', 'Verifier', 'Report', 'Persistence'].map((label) => (
            <span key={label} className="rounded-full border border-r1-accent/40 bg-r1-accent/10 px-3 py-1 text-r1-text">
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
