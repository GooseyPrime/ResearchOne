import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

const ROWS = [
  {
    topic: 'Per-claim citations',
    us: 'Every claim binds to source spans; verifier gates publication.',
    typical: 'Often aggregate links without claim-level binding.',
  },
  {
    topic: 'Evidence tiers',
    us: 'Established / strong / testimony / inference / speculation surfaced in the report.',
    typical: 'Tiers rarely exposed as a first-class reader contract.',
  },
  {
    topic: 'Adversarial skeptic pass',
    us: 'Dedicated pipeline stage attacks the draft before synthesis ships.',
    typical: 'Self-critique, if any, is not structured as an auditable stage.',
  },
  {
    topic: 'Contradictions',
    us: 'Named, preserved outputs instead of forced consensus.',
    typical: 'Tends to collapse disagreement into a single narrative.',
  },
  {
    topic: 'Living, versioned updates',
    us: 'Monitored reruns with rollbackable versions and audit trail.',
    typical: 'Usually requires a full manual re-run from scratch.',
  },
] as const;

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">How ResearchOne differs</h1>
        <p className="mt-3 max-w-3xl text-r1-text-muted">
          A capability lens — not a vendor scorecard. Where defense matters, the pipeline, skeptic pass, and citation
          bind are the product.
        </p>
        <div
          data-testid="compare-surface"
          className="r1-marketing-surface mt-10 overflow-hidden rounded-xl border border-white/10"
        >
          <div className="hidden md:block">
            <table className="min-w-full text-left text-sm">
              <caption className="sr-only">ResearchOne compared to typical general-purpose research assistants</caption>
              <thead className="border-b border-white/10 bg-r1-bg-deep">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold text-r1-text-muted">
                    Topic
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold text-r1-text">
                    ResearchOne
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold text-r1-text-muted">
                    Typical assistant-shaped research
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.topic} className="group border-b border-white/10 last:border-b-0">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-r1-bg-deep px-4 py-3 text-left font-medium text-r1-text group-hover:bg-surface-200"
                    >
                      {row.topic}
                    </th>
                    <td className="bg-r1-bg-deep px-4 py-3 text-r1-text group-hover:bg-surface-200">{row.us}</td>
                    <td className="bg-r1-bg-deep px-4 py-3 text-r1-text-muted group-hover:bg-surface-200">
                      {row.typical}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-white/10 md:hidden">
            {ROWS.map((row) => (
              <article key={row.topic} className="space-y-3 p-4">
                <h2 className="text-sm font-semibold text-r1-text">{row.topic}</h2>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-r1-accent">ResearchOne</p>
                  <p className="mt-1 text-sm text-r1-text">{row.us}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-r1-text-muted">Typical</p>
                  <p className="mt-1 text-sm text-r1-text-muted">{row.typical}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
        <p className="mt-8 text-sm text-r1-text-muted">
          Want the side-by-side on the homepage?{' '}
          <Link to="/" className="text-r1-accent hover:underline">
            Back to landing →
          </Link>
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
