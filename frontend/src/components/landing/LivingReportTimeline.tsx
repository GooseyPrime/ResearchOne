import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  BADGE_COPY,
  LIVING_REPORT_VERSIONS,
  type LivingVersionDef,
} from './livingReportTimelineData';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => setReduced(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return reduced;
}

function MockDocument({ version }: { version: LivingVersionDef }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0F1318] p-4 text-left text-sm text-r1-text shadow-inner">
      <p className="font-serif text-base font-semibold">Living report preview</p>
      <p className="mt-2 text-xs text-r1-text-muted">Corroboration state: {version.tierLabel}</p>
      <p className="mt-3 leading-relaxed text-r1-text">
        Fasting insulin improved in adults with metabolic syndrome
        {version.citationCount >= 1 ? (
          <sup className="ml-0.5 text-[10px] text-r1-accent">[1]</sup>
        ) : null}
        . Effect sizes were heterogeneous across protocols
        {version.citationCount >= 2 ? (
          <sup className="ml-0.5 text-[10px] text-r1-accent">[2]</sup>
        ) : null}
        .
        {version.showContradiction ? (
          <span className="ml-1 rounded border border-[#D45B9E]/50 bg-[#D45B9E]/10 px-1.5 py-0.5 text-xs font-medium text-[#D45B9E]">
            Contradiction preserved
          </span>
        ) : null}
        {version.citationCount >= 3 ? (
          <span className="text-r1-text-muted">
            {' '}
            Long-term adherence remains under-measured<sup className="text-[10px] text-r1-accent">[3]</sup>.
          </span>
        ) : null}
      </p>
    </div>
  );
}

export default function LivingReportTimeline() {
  const uid = useId();
  const reducedMotion = usePrefersReducedMotion();
  const lastIdx = LIVING_REPORT_VERSIONS.length - 1;
  const [idx, setIdx] = useState(reducedMotion ? lastIdx : 0);
  const [autoplay, setAutoplay] = useState(!reducedMotion);
  const railRef = useRef<HTMLDivElement>(null);
  const announceId = `${uid}-live`;

  const version = LIVING_REPORT_VERSIONS[idx];

  const cumulativeBadges = useMemo(() => {
    const out: LivingVersionDef['badges'][number][] = [];
    for (let i = 0; i <= idx; i += 1) {
      for (const b of LIVING_REPORT_VERSIONS[i].badges) {
        if (!out.some((x) => x.type === b.type && x.text === b.text)) out.push(b);
      }
    }
    return out;
  }, [idx]);

  useEffect(() => {
    if (reducedMotion) {
      setIdx(lastIdx);
      setAutoplay(false);
    }
  }, [reducedMotion, lastIdx]);

  useEffect(() => {
    if (!autoplay || reducedMotion) return;
    const t = window.setInterval(() => {
      setIdx((i) => (i >= lastIdx ? 0 : i + 1));
    }, 2800);
    return () => window.clearInterval(t);
  }, [autoplay, lastIdx, reducedMotion]);

  const liveText = useMemo(() => {
    const parts = cumulativeBadges.map((b) => `${BADGE_COPY[b.type].verb}: ${b.text}`);
    return `${version.label}. ${parts.join(' ')}`;
  }, [version, cumulativeBadges]);

  const bump = useCallback(
    (delta: number) => {
      setAutoplay(false);
      setIdx((i) => Math.max(0, Math.min(lastIdx, i + delta)));
    },
    [lastIdx]
  );

  const onKeyDownRail = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        bump(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        bump(-1);
      }
    },
    [bump]
  );

  if (reducedMotion) {
    const v = LIVING_REPORT_VERSIONS[lastIdx];
    return (
      <div data-testid="living-report-timeline">
        <div className="rounded-lg border border-white/10 bg-r1-bg-deep p-4">
          <p className="text-sm font-semibold text-r1-text">Final version (reduced motion)</p>
          <p className="mt-1 text-xs text-r1-text-muted">
            {v.label} · {v.date}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(Object.keys(BADGE_COPY) as Array<keyof typeof BADGE_COPY>).map((k) => (
              <span
                key={k}
                data-badge-type={k}
                className={`rounded-full border px-2 py-1 text-[11px] ${BADGE_COPY[k].className}`}
              >
                {BADGE_COPY[k].symbol} {BADGE_COPY[k].verb}
              </span>
            ))}
          </div>
          <div className="mt-6">
            <MockDocument version={v} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="living-report-timeline">
      <div
        ref={railRef}
        role="group"
        aria-labelledby={`${uid}-scrub-label`}
        className="relative h-16 rounded-lg border border-white/10 bg-r1-bg-deep px-2 outline-none focus-within:ring-2 focus-within:ring-r1-accent"
        onKeyDown={onKeyDownRail}
        onMouseDown={() => setAutoplay(false)}
      >
        <p id={`${uid}-scrub-label`} className="sr-only">
          Report version scrubber. Use left and right arrow keys to change version.
        </p>
        <div id={announceId} className="sr-only" aria-live="polite" aria-atomic="true">
          {liveText}
        </div>
        <div className="absolute bottom-3 left-4 right-4 top-6 flex items-end justify-between">
          {LIVING_REPORT_VERSIONS.map((v, i) => {
            const active = i === idx;
            return (
              <button
                key={v.label}
                type="button"
                className={`group flex flex-col items-center gap-1 rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-r1-accent ${
                  active ? 'text-r1-accent' : 'text-r1-text-muted'
                }`}
                onClick={() => {
                  setAutoplay(false);
                  setIdx(i);
                }}
                aria-current={active ? 'true' : undefined}
              >
                <span
                  className={`h-3 w-3 rounded-full border transition ${
                    active ? 'border-r1-accent bg-r1-accent' : 'border-white/30 bg-transparent group-hover:border-white/50'
                  }`}
                />
                <span className="text-[10px] font-mono">{v.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex min-h-[3rem] flex-wrap gap-2">
        {cumulativeBadges.map((b) => {
          const meta = BADGE_COPY[b.type];
          return (
            <span
              key={`${version.label}-${b.type}-${b.text.slice(0, 8)}`}
              data-badge-type={b.type}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${meta.className}`}
            >
              <span aria-hidden="true">{meta.symbol}</span>
              <span className="font-medium">{meta.verb}</span>
              <span className="text-r1-text-muted">{b.text}</span>
            </span>
          );
        })}
      </div>

      <div className="mt-6 min-h-[200px]">
        <MockDocument version={version} />
      </div>
    </div>
  );
}
