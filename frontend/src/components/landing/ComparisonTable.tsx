import { Check, CircleDot, Minus } from 'lucide-react';

type Cell = 'yes' | 'no' | 'partial';

const ROWS: Array<{ capability: string; researchOne: Cell; generalPurpose: Cell }> = [
  { capability: 'Per-claim citations', researchOne: 'yes', generalPurpose: 'no' },
  { capability: 'Source tier disclosure', researchOne: 'yes', generalPurpose: 'no' },
  { capability: 'Dedicated skeptic check', researchOne: 'yes', generalPurpose: 'no' },
  { capability: 'Preserved contradictions', researchOne: 'yes', generalPurpose: 'no' },
  { capability: 'Versioned, living updates', researchOne: 'yes', generalPurpose: 'partial' },
  { capability: 'Cited counter-claims', researchOne: 'yes', generalPurpose: 'partial' },
  { capability: 'Auditable citation-and-source chain', researchOne: 'yes', generalPurpose: 'partial' },
  { capability: 'BYOK / sovereign tier', researchOne: 'yes', generalPurpose: 'no' },
];

function CellIcon({ value }: { value: Cell }) {
  if (value === 'yes') {
    return (
      <Check className="mx-auto h-5 w-5 text-r1-accent" strokeWidth={2.2} aria-label="ResearchOne supports this capability" />
    );
  }
  if (value === 'partial') {
    return (
      <CircleDot className="mx-auto h-5 w-5 text-cyan-300/90" strokeWidth={2} aria-label="Partial support for this capability" />
    );
  }
  return <Minus className="mx-auto h-5 w-5 text-r1-text-muted" strokeWidth={2} aria-label="Not supported" />;
}

export default function ComparisonTable() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="font-serif text-3xl text-r1-text">Built for defensible decisions.</h2>
      <p className="mt-3 max-w-3xl text-r1-text-muted">
        Side-by-side with general-purpose research assistants. We win where defense matters.
      </p>

      {/* Opaque surface: lab-notebook ruling must not show through or beat against row borders (see site audit note). */}
      <div
        data-testid="comparison-table-surface"
        className="r1-marketing-surface mt-6 overflow-hidden rounded-xl border border-white/10 shadow-sm shadow-black/20"
      >
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">
              Capability comparison: ResearchOne versus general-purpose deep research assistants
            </caption>
            <thead className="sticky top-0 z-20 bg-r1-bg-deep">
              <tr className="border-b border-white/10">
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-r1-text-muted">
                  Capability
                </th>
                <th scope="col" className="min-w-[8rem] px-4 py-3 text-center text-sm font-semibold text-r1-text">
                  ResearchOne
                </th>
                <th scope="col" className="min-w-[10rem] px-4 py-3 text-center text-sm font-semibold text-r1-text-muted">
                  General-purpose deep research
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.capability} className="group border-b border-white/10 last:border-b-0">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap bg-r1-bg-deep px-4 py-3 text-left font-medium text-r1-text shadow-[4px_0_8px_-4px_rgba(0,0,0,0.4)] group-hover:bg-surface-200"
                  >
                    {row.capability}
                  </th>
                  <td className="bg-r1-bg-deep px-4 py-3 text-center group-hover:bg-surface-200">
                    <CellIcon value={row.researchOne} />
                  </td>
                  <td className="bg-r1-bg-deep px-4 py-3 text-center group-hover:bg-surface-200">
                    <CellIcon value={row.generalPurpose} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-white/10 md:hidden">
          <p className="sr-only">
            Same comparison as the desktop table: each card is one capability row.
          </p>
          {ROWS.map((row) => (
            <article key={row.capability} className="space-y-3 p-4">
              <h3 className="text-sm font-semibold text-r1-text">{row.capability}</h3>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-r1-accent">ResearchOne</p>
                  <div className="mt-2 flex justify-start">
                    <CellIcon value={row.researchOne} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-r1-text-muted">General-purpose</p>
                  <div className="mt-2 flex justify-start">
                    <CellIcon value={row.generalPurpose} />
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
