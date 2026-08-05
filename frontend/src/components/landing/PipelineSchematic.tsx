import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { PersonaId } from './persona/personaResolver';
import {
  PIPELINE_CAPSULE_CENTERS_X,
  PIPELINE_SCHEMATIC_STAGES,
  PIPELINE_SCHEMATIC_VIEWBOX,
  PIPELINE_SKEPTIC_APEX_Y,
  PIPELINE_SPINE_Y,
  STAGE_COLOR,
  type PipelineStageDef,
} from './pipelineSchematicData';

const VIEW_W = PIPELINE_SCHEMATIC_VIEWBOX.width;
const VIEW_H = PIPELINE_SCHEMATIC_VIEWBOX.height;

export const PIPELINE_SCHEMATIC_ARIA_LABEL =
  'Illustrative ResearchOne specialist flow from intake through versioned reporting, with an optional challenge verification loop';

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(' ');
}

function PipelineSchematicMobile() {
  return (
    <div
      className="flex flex-col gap-3 md:hidden"
      role="list"
      aria-label="Pipeline stages"
    >
      {PIPELINE_SCHEMATIC_STAGES.map((s) => (
        <article
          key={s.index}
          role="listitem"
          className="snap-center rounded-xl border border-white/10 bg-r1-bg-deep p-4 shadow-sm"
        >
          <p className="font-mono text-[10px] uppercase tracking-widest text-r1-accent">
            Stage {s.index} · {s.agent}
          </p>
          <h3 className="mt-1 font-semibold text-r1-text">{s.stageName}</h3>
          <p className="mt-2 text-xs text-r1-text-muted">
            {s.input} → {s.output}
          </p>
          {s.index === 7 ? (
            <p className="mt-2 inline-flex rounded-full border border-[#D45B9E]/60 bg-[#D45B9E]/10 px-2 py-1 text-[10px] font-medium text-[#D45B9E]">
              Optional verification loop
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

interface PipelineSchematicProps {
  resolvedPersona?: PersonaId;
}

export default function PipelineSchematic({ resolvedPersona: _resolvedPersona }: PipelineSchematicProps) {
  const uid = useId();
  const reducedMotion = useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [inView, setInView] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCard = hovered ?? focused;

  const cancelHoverClear = useCallback(() => {
    if (hoverLeaveTimerRef.current != null) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
  }, []);

  const scheduleHoverClear = useCallback(() => {
    cancelHoverClear();
    hoverLeaveTimerRef.current = setTimeout(() => {
      setHovered(null);
      hoverLeaveTimerRef.current = null;
    }, 200);
  }, [cancelHoverClear]);

  useEffect(() => () => cancelHoverClear(), [cancelHoverClear]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setInView(e.isIntersecting && e.intersectionRatio >= 0.25);
      },
      { threshold: [0, 0.25, 0.5, 1] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const spineD = useMemo(() => {
    const xs = PIPELINE_CAPSULE_CENTERS_X;
    return `M ${xs[0]},${PIPELINE_SPINE_Y} ${xs
      .slice(1)
      .map((x) => `L ${x},${PIPELINE_SPINE_Y}`)
      .join(' ')}`;
  }, []);

  const skepticPathD = useMemo(() => {
    const x6 = PIPELINE_CAPSULE_CENTERS_X[5];
    const x7 = PIPELINE_CAPSULE_CENTERS_X[6];
    const x8 = PIPELINE_CAPSULE_CENTERS_X[7];
    const y = PIPELINE_SPINE_Y;
    const yLow = PIPELINE_SKEPTIC_APEX_Y;
    return `M ${x6},${y + 28} C ${x6 + 40},${yLow} ${x8 - 40},${yLow} ${x8},${y + 28} L ${x7},${y + 28}`;
  }, []);

  const pauseMotion = activeCard != null || !inView;

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setFocused(null);
  }, []);

  const stageCard = (s: PipelineStageDef) => (
    <div
      data-testid="pipeline-stage-detail-card"
      className="pointer-events-auto z-[80] w-[min(22rem,calc(100vw-2.5rem))] min-w-[17rem] rounded-lg border border-white/20 bg-r1-bg-deep/95 p-3.5 text-left shadow-2xl ring-1 ring-black/30 backdrop-blur-md sm:min-w-[18.5rem] sm:p-4"
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-r1-accent">Stage {s.index}</p>
      <p className="mt-1 text-base font-semibold text-r1-text">{s.stageName}</p>
      <p className="mt-1.5 text-[13px] text-r1-text-muted">Agent: {s.agent}</p>
      <p className="mt-1 text-[13px] text-r1-text-muted">In: {s.input}</p>
      <p className="mt-1 text-[13px] text-r1-text-muted">Out: {s.output}</p>
      <p className="mt-2.5 text-sm leading-relaxed text-r1-text">{s.rationale}</p>
    </div>
  );

  /** Bottom of stage capsule; `clamp` keeps wide cards on-screen near diagram edges. */
  const cardAnchorStyle = (cx: number): CSSProperties => {
    const leftPct = (cx / VIEW_W) * 100;
    const topPct = ((PIPELINE_SPINE_Y + 28) / VIEW_H) * 100;
    return {
      left: `clamp(0.75rem, ${leftPct}%, calc(100% - 0.75rem))`,
      top: `${topPct}%`,
      transform: 'translate(-50%, 0)',
    };
  };

  return (
    <div ref={rootRef} className="relative w-full" onKeyDown={onKeyDown}>
      <div className="hidden w-full origin-top pb-1 md:block md:aspect-[1440/420] md:scale-[1.04] md:pb-2">
        <div
          role="group"
          aria-label={PIPELINE_SCHEMATIC_ARIA_LABEL}
          className="relative h-full w-full overflow-visible"
          data-testid="pipeline-schematic"
        >
          <p className="sr-only">
            This diagram shows one illustrative specialist flow. Some runs use fewer steps and different routing based
            on scope, depth, and verification needs. Ambient markers show source movement through the flow when motion is enabled.
          </p>
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-auto w-full max-w-full">
            <defs>
              <linearGradient id={`${uid}-pkt`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#5BC0EB" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#5BC0EB" stopOpacity="1" />
              </linearGradient>
            </defs>

            {/* Input hex */}
            <polygon
              points={hexPoints(80, PIPELINE_SPINE_Y, 36)}
              fill="#0F1318"
              stroke="#7C8FA1"
              strokeWidth={1.5}
              strokeOpacity={0.6}
            />
            <text x={80} y={PIPELINE_SPINE_Y + 4} textAnchor="middle" className="fill-r1-text-muted text-[10px]">
              Question
            </text>

            {/* Output hex */}
            <polygon
              points={hexPoints(1360, PIPELINE_SPINE_Y, 36)}
              fill="#0F1318"
              stroke="#7C8FA1"
              strokeWidth={1.5}
              strokeOpacity={0.6}
            />
            <text x={1360} y={PIPELINE_SPINE_Y + 4} textAnchor="middle" className="fill-r1-text-muted text-[10px]">
              Living Report
            </text>

            <path id={`${uid}-spine`} d={spineD} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1.5} />
            <path
              id={`${uid}-skeptic`}
              d={skepticPathD}
              fill="none"
              stroke="#D45B9E"
              strokeWidth={1.5}
              strokeOpacity={0.75}
              strokeDasharray="6 6"
              data-testid="pipeline-skeptic-loop-path"
            />

            {!reducedMotion && !pauseMotion ? (
              <>
                <circle r={4} fill={`url(#${uid}-pkt)`}>
                  <animateMotion dur="12s" repeatCount="indefinite" rotate="auto" path={spineD} />
                </circle>
                <circle r={4} fill="#F0C674" opacity={0.85}>
                  <animateMotion dur="12s" repeatCount="indefinite" begin="4s" rotate="auto" path={spineD} />
                </circle>
                <circle r={4} fill="#5BC0EB" opacity={0.75}>
                  <animateMotion dur="12s" repeatCount="indefinite" begin="8s" rotate="auto" path={spineD} />
                </circle>
                <circle r={3} fill="#D45B9E">
                  <animateMotion dur="8s" repeatCount="indefinite" rotate="auto" path={skepticPathD} />
                </circle>
              </>
            ) : null}

            {reducedMotion ? (
              <g>
                <circle cx={PIPELINE_CAPSULE_CENTERS_X[5]} cy={PIPELINE_SPINE_Y} r={5} fill="#F0C674" />
                <text
                  x={PIPELINE_CAPSULE_CENTERS_X[5]}
                  y={PIPELINE_SPINE_Y - 16}
                  textAnchor="middle"
                  className="fill-r1-accent text-[11px]"
                >
                  + challenge review
                </text>
              </g>
            ) : null}

            {/* Optional verification loop label */}
            <text
              x={(PIPELINE_CAPSULE_CENTERS_X[5] + PIPELINE_CAPSULE_CENTERS_X[7]) / 2}
              y={PIPELINE_SKEPTIC_APEX_Y + 24}
              textAnchor="middle"
              className="fill-[#D45B9E] text-[11px] font-medium"
            >
              Optional verification loop
            </text>

            {PIPELINE_SCHEMATIC_STAGES.map((s) => {
              const cx = PIPELINE_CAPSULE_CENTERS_X[s.index - 1];
              const cy = PIPELINE_SPINE_Y;
              const col = STAGE_COLOR[s.agentKind];
              const open = activeCard === s.index;
              const isSkeptic = s.agentKind === 'skeptic';
              return (
                <g
                  key={s.index}
                  transform={`translate(${cx - 48}, ${cy - 28})`}
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  aria-label={`${s.stageName}, ${s.agent}`}
                  onMouseEnter={() => {
                    cancelHoverClear();
                    setHovered(s.index);
                  }}
                  onMouseLeave={scheduleHoverClear}
                  onFocus={() => setFocused(s.index)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setFocused((prev) => (prev === s.index ? null : s.index));
                    }
                  }}
                >
                  <title>{`${s.stageName} — ${s.agent}`}</title>
                  <rect
                    width={96}
                    height={56}
                    rx={14}
                    fill="#0F1318"
                    stroke={col}
                    strokeWidth={isSkeptic ? 2 : 1.25}
                    strokeOpacity={0.65}
                    className={open ? 'opacity-100' : 'opacity-95'}
                  />
                  {isSkeptic ? (
                    <rect x={-2} y={-2} width={100} height={60} rx={15} fill="none" stroke="#D45B9E" strokeOpacity={0.25} />
                  ) : null}
                  <text x={84} y={14} textAnchor="end" className="fill-r1-text-muted text-[10px]">
                    {s.index}
                  </text>
                  <text x={48} y={34} textAnchor="middle" className="fill-r1-text text-[12px] font-medium">
                    {s.stageName}
                  </text>
                  <text x={48} y={48} textAnchor="middle" className="fill-r1-text-muted text-[9px]">
                    {s.output.length > 18 ? `${s.output.slice(0, 16)}…` : s.output}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* HTML overlay — cards open upward so they are not clipped by the frame below */}
          <div className="pointer-events-none absolute inset-0 overflow-visible">
            {PIPELINE_SCHEMATIC_STAGES.map((s) => {
              const cx = PIPELINE_CAPSULE_CENTERS_X[s.index - 1];
              const open = activeCard === s.index;
              if (!open) return null;
              return (
                <div
                  key={`card-${s.index}`}
                  className="pointer-events-none absolute z-[70]"
                  style={cardAnchorStyle(cx)}
                >
                  <div className="pointer-events-auto relative">
                    <div
                      className="absolute bottom-full left-1/2 z-[80] mb-2 -translate-x-1/2"
                      onMouseEnter={cancelHoverClear}
                      onMouseLeave={scheduleHoverClear}
                    >
                      {stageCard(s)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="md:hidden">
        <PipelineSchematicMobile />
      </div>
    </div>
  );
}
