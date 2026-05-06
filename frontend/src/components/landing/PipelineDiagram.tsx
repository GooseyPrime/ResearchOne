const STAGES = [
  'Planner',
  'Discovery',
  'Retriever',
  'Analysis',
  'Reasoner',
  'Skeptic',
  'Synthesizer',
  'Verifier',
  'Report',
  'Persistence',
];

export default function PipelineDiagram() {
  return (
    <div className="rounded-xl border border-white/10 bg-r1-bg-deep p-5">
      <p className="mb-4 text-sm text-r1-text-muted">10 stages. 7 specialized agents. One report.</p>
      <div className="grid gap-2 md:grid-cols-5">
        {STAGES.map((stage, index) => (
          <div key={stage} className="rounded-md border border-r1-accent/25 bg-r1-bg px-3 py-2 text-xs text-r1-text">
            <span className="mr-2 text-r1-accent">{index + 1}.</span>
            {stage}
          </div>
        ))}
      </div>
    </div>
  );
}
