const ROWS: Array<{ capability: string; researchOne: string; generalPurpose: string }> = [
  {
    capability: 'Output format',
    researchOne: 'Citation-grade report (durable, retained 120 days)',
    generalPurpose: 'Chat thread (ephemeral)',
  },
  {
    capability: 'Methodology choice',
    researchOne: 'Five explicit deep research modes',
    generalPurpose: 'One implicit pipeline',
  },
  {
    capability: 'Self-critique pass',
    researchOne: 'Dedicated skeptic agent attacks every draft',
    generalPurpose: 'Not exposed to user',
  },
  {
    capability: 'Source role tagging',
    researchOne: 'Every source assigned a role; every claim tagged by evidence tier',
    generalPurpose: 'Aggregate citation list',
  },
  {
    capability: 'Contradiction handling',
    researchOne: 'Preserved as named outputs',
    generalPurpose: 'Smoothed into consensus',
  },
  {
    capability: 'Reports that update',
    researchOne: 'Living Reports — monitored, versioned, rollbackable',
    generalPurpose: 'Re-run from scratch',
  },
  {
    capability: 'Bring your own model',
    researchOne: 'BYOK and Sovereign tiers',
    generalPurpose: 'Vendor-locked',
  },
  {
    capability: 'Audit trail',
    researchOne: 'Per-mode, per-source, per-revision audit log',
    generalPurpose: 'Conversation history',
  },
];

export default function ComparisonTable() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="font-serif text-3xl text-r1-text">Built for defensible decisions, not chat answers.</h2>
      <p className="mt-3 max-w-3xl text-r1-text-muted">
        Chat-style AI research is built for fast cited answers. ResearchOne is built for the questions where speed
        isn&apos;t the bottleneck — where contradictions matter, where every claim needs a defensible source, and where
        the report has to outlive the chat thread.
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
                <th scope="col" className="min-w-[12rem] px-4 py-3 font-semibold text-r1-text">
                  ResearchOne
                </th>
                <th scope="col" className="min-w-[12rem] px-4 py-3 font-semibold text-r1-text-muted">
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
                  <td className="bg-r1-bg-deep px-4 py-3 text-r1-text group-hover:bg-surface-200">{row.researchOne}</td>
                  <td className="bg-r1-bg-deep px-4 py-3 text-r1-text-muted group-hover:bg-surface-200">{row.generalPurpose}</td>
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
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-r1-accent">ResearchOne</p>
                <p className="mt-1 text-sm text-r1-text">{row.researchOne}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-r1-text-muted">General-purpose</p>
                <p className="mt-1 text-sm text-r1-text-muted">{row.generalPurpose}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-r1-text-muted">
        If you need a fast cited answer in 30 seconds, use a chat tool. If you need a report you can hand to your board,
        your counsel, or your peer reviewer — use this.
      </p>
    </section>
  );
}
