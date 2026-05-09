const CHECKPOINTS = [
  { label: 'v1.0 generated', day: 'Day 0', type: 'version' as const },
  { label: 'Source flagged: retraction', day: 'Day 12', type: 'flag' as const },
  { label: 'v1.1 — citations updated', day: 'Day 13', type: 'version' as const },
  { label: 'New primary source added', day: 'Day 41', type: 'event' as const },
  { label: 'v1.2 — synthesis revised', day: 'Day 42', type: 'version' as const },
  { label: 'Pinned by team', day: 'Day 60', type: 'pin' as const },
] as const;

function dotColor(type: 'version' | 'flag' | 'event' | 'pin'): string {
  switch (type) {
    case 'version': return 'fill-r1-accent';
    case 'flag': return 'fill-tier-testimony';
    case 'event': return 'fill-r1-text-muted';
    case 'pin': return 'fill-tier-established_fact';
  }
}

function dotRadius(type: 'version' | 'flag' | 'event' | 'pin'): number {
  return type === 'version' || type === 'pin' ? 7 : 5;
}

export default function LivingReportTimeline() {
  return (
    <div>
      {/* Desktop: horizontal SVG */}
      <div className="hidden sm:block">
        <svg
          viewBox="0 0 800 100"
          className="w-full"
          role="img"
          aria-label="Living Report timeline showing six events over 60 days: version generation, source retraction flagged, citation update, new source added, synthesis revision, and team pin"
        >
          <line
            x1="40" y1="50" x2="760" y2="50"
            className="stroke-r1-text-muted"
            strokeWidth="2"
            strokeOpacity="0.3"
          />
          {CHECKPOINTS.map((cp, i) => {
            const x = 40 + i * (720 / (CHECKPOINTS.length - 1));
            const r = dotRadius(cp.type);
            return (
              <g key={cp.label}>
                <circle cx={x} cy={50} r={r} className={dotColor(cp.type)} />
                <text
                  x={x}
                  y={30}
                  textAnchor="middle"
                  className="fill-r1-text text-[8px]"
                >
                  {cp.label.length > 20 ? cp.label.slice(0, 20) + '…' : cp.label}
                </text>
                <text
                  x={x}
                  y={72}
                  textAnchor="middle"
                  className="fill-r1-text-muted text-[7px]"
                >
                  {cp.day}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Mobile: vertical list */}
      <div className="flex flex-col gap-3 sm:hidden">
        {CHECKPOINTS.map((cp) => (
          <div key={cp.label} className="flex items-center gap-3">
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                cp.type === 'version' ? 'bg-r1-accent' :
                cp.type === 'flag' ? 'bg-tier-testimony' :
                cp.type === 'pin' ? 'bg-tier-established_fact' :
                'bg-r1-text-muted'
              }`}
              aria-hidden="true"
            />
            <span className="text-xs text-r1-text">{cp.label}</span>
            <span className="ml-auto text-xs text-r1-text-muted">{cp.day}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-r1-text-muted">
        Roll back to any version anytime. Living Reports retain the source set, monitoring config, and revision history while active.
      </p>
    </div>
  );
}
