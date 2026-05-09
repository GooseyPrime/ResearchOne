const rows = [
  ['Output format', 'Chat thread (ephemeral)', 'Citation-grade report (durable, retained 120 days)'],
  ['Methodology choice', 'One implicit pipeline', 'Five explicit deep research modes'],
  ['Self-critique pass', 'Not exposed to user', 'Dedicated skeptic agent attacks every draft'],
  ['Source role tagging', 'Aggregate citation list', 'Every claim tagged by evidence tier'],
  ['Contradiction handling', 'Smoothed into consensus', 'Preserved as named outputs'],
  ['Reports that update', 'Re-run from scratch', 'Living Reports — monitored, versioned, rollbackable'],
  ['Bring your own model', 'Vendor-locked', 'BYOK and Sovereign tiers'],
  ['Audit trail', 'Conversation history', 'Per-mode, per-source, per-revision audit log'],
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
      <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-r1-bg-deep text-r1-text">
            <tr>
              <th className="px-4 py-3">Capability</th>
              <th className="px-4 py-3">Chat-style AI research</th>
              <th className="px-4 py-3">ResearchOne</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-t border-white/10">
                <td className="px-4 py-3 font-medium text-r1-text">{row[0]}</td>
                <td className="px-4 py-3 text-r1-text-muted">{row[1]}</td>
                <td className="px-4 py-3 text-r1-text">{row[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-r1-text-muted">
        If you need a fast cited answer in 30 seconds, use a chat tool. If you need a report you can hand to your board,
        your counsel, or your peer reviewer — use this.
      </p>
    </section>
  );
}
