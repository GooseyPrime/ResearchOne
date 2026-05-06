const rows = [
  ['Optimized for', 'Fast cited answers', 'Long-form, contestable research'],
  ['Architecture', 'Single model + retrieval', '10-stage multi-agent pipeline'],
  ['Skeptic agent', 'No', 'Yes — attacks every draft'],
  ['Contradiction handling', 'Smoothed into consensus', 'Preserved as named outputs'],
  ['Evidence tiering', 'Implicit at best', 'Explicit on every claim'],
  ['Model policy', 'Vendor-controlled', 'You choose; BYOK available'],
  ['Best for', 'Quick research, summaries', 'Diligence, investigations, hard questions'],
];

export default function ComparisonTable() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="font-serif text-3xl text-r1-text">Why not just use ChatGPT or Perplexity?</h2>
      <p className="mt-3 max-w-3xl text-r1-text-muted">
        Because they&apos;re built for different jobs. ChatGPT and Perplexity are excellent at fast answers with
        citations. ResearchOne is built for the questions where speed isn&apos;t the bottleneck and a one-pass summary
        isn&apos;t enough.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-r1-bg-deep text-r1-text">
            <tr>
              <th className="px-4 py-3">Capability</th>
              <th className="px-4 py-3">Perplexity / ChatGPT</th>
              <th className="px-4 py-3">ResearchOne</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-t border-white/10">
                {row.map((cell) => (
                  <td key={cell} className="px-4 py-3 text-r1-text-muted">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-r1-text-muted">
        If you need a fast answer, use Perplexity. If you need a defensible report, use this.
      </p>
    </section>
  );
}
