import clsx from 'clsx';

export type ResearchEngineMode = 'standard' | 'deep';

const MODE_COPY: Record<
  ResearchEngineMode,
  { title: string; description: string }
> = {
  standard: {
    title: 'Standard Research',
    description:
      'Fast, multi-source research and summarization. Best for general inquiries and historical context.',
  },
  deep: {
    title: 'Deep Research',
    description:
      'Full multi-stage pipeline with research types, longer reports, and a skeptic step that argues against the draft to catch weak claims.',
  },
};

type ResearchEngineModeToggleProps = {
  mode: ResearchEngineMode;
  onModeChange: (next: ResearchEngineMode) => void;
  deepLocked?: boolean;
};

export default function ResearchEngineModeToggle({
  mode,
  onModeChange,
  deepLocked = false,
}: ResearchEngineModeToggleProps) {
  return (
    <div className="space-y-3" role="tablist" aria-label="Research method">
      <div className="grid gap-2 sm:grid-cols-2">
        {(['standard', 'deep'] as const).map((key) => {
          const selected = mode === key;
          const copy = MODE_COPY[key];
          const isDeepTab = key === 'deep';
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={clsx(
                'rounded-lg border px-4 py-3 text-left transition-colors',
                selected
                  ? 'border-accent/50 bg-accent/15 shadow-sm'
                  : 'border-surface-400/80 bg-surface-200/30 hover:border-accent/30',
                isDeepTab && deepLocked && !selected && 'opacity-80'
              )}
              onClick={() => onModeChange(key)}
            >
              <span className="block text-sm font-semibold text-white">{copy.title}</span>
              <span className="mt-1 block text-xs text-slate-400 leading-relaxed">{copy.description}</span>
              {isDeepTab && deepLocked ? (
                <span className="mt-2 inline-block text-xs text-amber-400/90">Pro plan required</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
