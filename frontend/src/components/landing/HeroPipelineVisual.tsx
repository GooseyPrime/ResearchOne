import { HERO_PIPELINE_IMG_ARIA_LABEL } from './heroPipelineAria';

const PHASES = [
  {
    label: 'PLAN',
    stages: ['Planner', 'Discovery'],
  },
  {
    label: 'RETRIEVE & READ',
    stages: ['Retriever', 'Retriever Analysis'],
  },
  {
    label: 'REASON & VERIFY',
    stages: ['Reasoner', 'Challenge'],
  },
  {
    label: 'WRITE & CITE',
    stages: ['Drafting', 'Verifier', 'Report', 'Recordkeeping'],
  },
] as const;

export default function HeroPipelineVisual() {
  return (
    <div
      className="rounded-xl border border-white/10 bg-r1-bg-deep p-6"
      role="img"
      aria-label={HERO_PIPELINE_IMG_ARIA_LABEL}
    >
      <p className="sr-only">
        This example ResearchOne flow has four phases. Phase one, Plan, includes the Planner and Discovery stages.
        Phase two, Retrieve and Read, includes the Retriever and Retriever Analysis stages.
        Phase three, Reason and Verify, includes the Reasoner and Challenge stages when additional checking
        is needed.
        Phase four, Write and Cite, includes the Drafting, Verifier, Report, and Recordkeeping stages.
      </p>

      {/* Desktop: horizontal flow */}
      <div className="hidden md:flex md:items-start md:gap-3">
        {PHASES.map((phase, i) => (
          <div key={phase.label} className="flex flex-1 flex-col items-center">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-r1-accent">
                {phase.label}
              </span>
              {i < PHASES.length - 1 && (
                <span className="text-r1-text-muted" aria-hidden="true">→</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {phase.stages.map((stage) => (
                <span
                  key={stage}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    stage === 'Challenge'
                      ? 'animate-glow border-r1-accent bg-r1-accent/20 text-r1-text'
                      : 'border-r1-accent/30 bg-r1-accent/5 text-r1-text'
                  }`}
                  aria-label={stage === 'Challenge' ? 'Challenge pass' : undefined}
                >
                  {stage}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Mobile: vertical list */}
      <div className="flex flex-col gap-4 md:hidden">
        {PHASES.map((phase) => (
          <div key={phase.label}>
            <p className="font-mono text-[10px] uppercase tracking-wide text-r1-accent">
              {phase.label}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {phase.stages.map((stage) => (
                <span
                  key={stage}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    stage === 'Challenge'
                      ? 'animate-glow border-r1-accent bg-r1-accent/20 text-r1-text'
                      : 'border-r1-accent/30 bg-r1-accent/5 text-r1-text'
                  }`}
                  aria-label={stage === 'Challenge' ? 'Challenge pass' : undefined}
                >
                  {stage}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
