const MODES = [
  {
    mode: 'General Epistemic',
    bestFor: 'Contested questions where evidence is mixed',
    runTime: '8–15 min',
    overlay: 'Balanced planner; tier-weighted synthesizer',
    skepticIntensity: 'Standard' as const,
    outputEmphasis: 'Tiered evidence summary',
  },
  {
    mode: 'Investigative',
    bestFor: 'Tracking incentives, networks, narrative drift',
    runTime: '12–20 min',
    overlay: 'Actor-graph planner; timeline retriever',
    skepticIntensity: 'Elevated' as const,
    outputEmphasis: 'Timeline + actor map',
  },
  {
    mode: 'Patent / Technical Gap',
    bestFor: 'Mapping prior art and novelty',
    runTime: '10–18 min',
    overlay: 'Prior-art retriever; mechanism analyzer',
    skepticIntensity: 'Standard' as const,
    outputEmphasis: 'Gap analysis + novelty matrix',
  },
  {
    mode: 'Novel Application Discovery',
    bestFor: 'Mechanism → implementation paths',
    runTime: '10–15 min',
    overlay: 'Mechanism-first reasoner',
    skepticIntensity: 'Standard' as const,
    outputEmphasis: 'Application hypotheses',
  },
  {
    mode: 'Anomaly Correlation',
    bestFor: 'Are these signals related?',
    runTime: '10–18 min',
    overlay: 'Correlation planner; contradiction-preserving synthesizer',
    skepticIntensity: 'Elevated' as const,
    outputEmphasis: 'Hypothesis ranking with conflicts',
  },
] as const;

const COLUMNS = ['Mode', 'Best for', 'Typical run time', 'Mode-specific overlay', 'Skeptic intensity', 'Output emphasis'] as const;

export default function ModeMatrix() {
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[800px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-r1-bg-deep">
              {COLUMNS.map((col) => (
                <th key={col} scope="col" className="px-4 py-3 font-semibold text-r1-text">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODES.map((row) => (
              <tr key={row.mode} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-medium text-r1-text">{row.mode}</td>
                <td className="px-4 py-3 text-r1-text-muted">{row.bestFor}</td>
                <td className="px-4 py-3 text-r1-text-muted">{row.runTime}</td>
                <td className="px-4 py-3 text-r1-text-muted">{row.overlay}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    row.skepticIntensity === 'Elevated'
                      ? 'bg-tier-strong_evidence/20 text-tier-strong_evidence'
                      : 'bg-r1-text-muted/10 text-r1-text-muted'
                  }`}>
                    {row.skepticIntensity}
                  </span>
                </td>
                <td className="px-4 py-3 text-r1-text-muted">{row.outputEmphasis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-r1-text-muted">
        Each mode runs the full ten-stage pipeline. Mode-specific overlays adjust the planner, skeptic, and synthesizer.
      </p>
    </div>
  );
}
