import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import HeroPipelineVisual from '../HeroPipelineVisual';
import PipelineBeams from './pipelineBeams';
import {
  PIPELINE_STAGES,
  PIPELINE_VIEWBOX,
} from './pipelineLayout';
import {
  getBeamPalette,
  type BeamPalette,
} from './personaBeamPalettes';

/**
 * Animated multi-agent pipeline hero.
 *
 * Composition contract (Rule 27):
 *
 *   I-1  When `useReducedMotion()` returns true, render the existing
 *        static `<HeroPipelineVisual />` verbatim. No animation, no
 *        opacity transitions, nothing.
 *
 *   I-2  The static visual is imported, not duplicated.
 *
 *   I-5  Beam palette is read from the parent `[data-persona]`
 *        attribute (set by WO-V's `PersonaAwareHero`). Unknown or
 *        missing persona falls back to the default palette.
 *
 *   I-6  Animation is gated on viewport visibility via
 *        IntersectionObserver. Off-screen → paused.
 *
 *   I-8  ARIA preserved — same `role="img"` and label that
 *        `HeroPipelineVisual` exposes, applied to the wrapper here so
 *        the animated structure conveys equivalent info to non-sighted
 *        users. The decorative SVG beam layer is `aria-hidden`.
 *
 * Mobile breakpoint:
 *   Below `md:` (768px) we render the static `HeroPipelineVisual`
 *   directly. The animated layout requires a wide aspect ratio to
 *   read correctly; squeezing the 10-stage S-curve into a 375px wide
 *   phone screen looks bad and chews battery. Mobile gets the static
 *   vertical chain, which is already well-tuned in the existing
 *   component.
 */

const PIPELINE_ARIA_LABEL =
  'ResearchOne ten-stage pipeline grouped into four phases: Plan, Retrieve and Read, ' +
  'Reason and Challenge, Synthesize and Cite. The Skeptic is a dedicated adversarial ' +
  'agent that attacks the draft before it proceeds.';

export interface AnimatedPipelineHeroProps {
  /** Override persona detection for tests or A/B forced rendering. */
  forcePersona?: string;
  /** Override reduced-motion detection for tests. */
  forceReducedMotion?: boolean;
  /** Disable the viewport gate (animations always on). For tests. */
  alwaysAnimate?: boolean;
}

export default function AnimatedPipelineHero({
  forcePersona,
  forceReducedMotion,
  alwaysAnimate = false,
}: AnimatedPipelineHeroProps = {}) {
  const detectedReducedMotion = useReducedMotion();
  const reducedMotion =
    forceReducedMotion !== undefined ? forceReducedMotion : Boolean(detectedReducedMotion);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(alwaysAnimate);
  const [palette, setPalette] = useState<BeamPalette>(() => getBeamPalette(forcePersona));

  // IntersectionObserver gate (Rule 27 I-6).
  useEffect(() => {
    if (alwaysAnimate) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Old browser — fall back to always-on. Better than always-off
      // which would silently disable the animation.
      setIsVisible(true);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.intersectionRatio >= 0.25);
        });
      },
      { threshold: [0, 0.25, 0.5, 1] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [alwaysAnimate]);

  // Persona palette resolution.
  // Reads `data-persona` from the nearest ancestor element that has
  // it. WO-V's `PersonaAwareHero` sets `data-persona` on its <section>.
  // Falls back to forcePersona prop, then to 'default'.
  useEffect(() => {
    if (forcePersona) {
      setPalette(getBeamPalette(forcePersona));
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const ancestor = el.closest<HTMLElement>('[data-persona]');
    const persona = ancestor?.dataset.persona;
    setPalette(getBeamPalette(persona));
  }, [forcePersona]);

  // ─── Reduced motion path — pure render of the static visual ────
  if (reducedMotion) {
    return (
      <div data-testid="static-pipeline-fallback">
        <HeroPipelineVisual />
      </div>
    );
  }

  // ─── Mobile path — also use static visual ──────────────────────
  // We render BOTH and let Tailwind's responsive utilities pick.
  // The static visual on md+ is hidden; the animated one is hidden
  // below md. This is the standard responsive-visual pattern in this
  // codebase.

  return (
    <div ref={containerRef} className="w-full">
      {/* Mobile / narrow — fall back to the existing static layout. */}
      <div className="md:hidden" data-testid="pipeline-mobile-static">
        <HeroPipelineVisual />
      </div>

      {/* Desktop — animated. */}
      <div
        className="hidden md:block"
        role="img"
        aria-label={PIPELINE_ARIA_LABEL}
        data-testid="pipeline-animated"
      >
        {/* Screen-reader description matches the static visual. */}
        <p className="sr-only">
          The ResearchOne pipeline has four phases. Phase one, Plan, includes the Planner
          and Discovery stages. Phase two, Retrieve and Read, includes the Retriever and
          Retriever Analysis stages. Phase three, Reason and Challenge, includes the
          Reasoner and Skeptic stages. The Skeptic is a dedicated adversarial agent that
          attacks the draft before it proceeds. Phase four, Synthesize and Cite, includes
          the Synthesizer, Verifier, Report, and Epistemic Persistence stages.
        </p>

        <div
          className="relative rounded-xl border border-white/10 bg-r1-bg-deep/40 backdrop-blur-sm p-6"
          style={{
            aspectRatio: `${PIPELINE_VIEWBOX.width} / ${PIPELINE_VIEWBOX.height}`,
            // Min height ensures the animated visual doesn't collapse
            // to zero if the parent has odd flex behavior.
            minHeight: 260,
          }}
        >
          {/* Beam layer (decorative). */}
          <PipelineBeams palette={palette} active={isVisible} />

          {/* Node layer — positioned absolutely over the SVG. */}
          <div className="absolute inset-0">
            {PIPELINE_STAGES.map((stage) => {
              // Convert SVG-space coords to percentage of the inset
              // box so nodes track the SVG as it scales.
              const leftPct = (stage.x / PIPELINE_VIEWBOX.width) * 100;
              const topPct = (stage.y / PIPELINE_VIEWBOX.height) * 100;
              const isSkeptic = stage.id === 'skeptic';

              const ringColor = isSkeptic
                ? palette.skepticRing
                : palette.nodeIdleRing;
              const ringWidth = isSkeptic ? 2 : 1;
              const bgOpacity = isSkeptic ? 0.25 : 0.05;

              return (
                <motion.div
                  key={stage.id}
                  className="absolute flex items-center justify-center"
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    delay: stage.x / 1000 * 0.4,
                    duration: 0.4,
                  }}
                >
                  <span
                    data-stage-id={stage.id}
                    data-emphasis={isSkeptic ? 'skeptic' : undefined}
                    className="rounded-full px-3 py-1.5 text-[11px] font-medium whitespace-nowrap"
                    style={{
                      border: `${ringWidth}px solid ${ringColor}`,
                      background: isSkeptic
                        ? `rgba(255, 255, 255, ${bgOpacity})`
                        : `rgba(255, 255, 255, ${bgOpacity})`,
                      color: '#E0E0E0',
                      boxShadow: isSkeptic
                        ? `0 0 12px ${palette.skepticRing}55`
                        : 'none',
                    }}
                    aria-label={isSkeptic ? 'Skeptic, dedicated adversarial agent' : stage.label}
                  >
                    {stage.label}
                  </span>
                </motion.div>
              );
            })}
          </div>

          {/* Phase labels along the top edge. */}
          <div className="absolute top-2 left-0 right-0 flex justify-between px-6 pointer-events-none">
            {(['PLAN', 'RETRIEVE & READ', 'REASON & CHALLENGE', 'SYNTHESIZE & CITE'] as const).map(
              (label) => (
                <span
                  key={label}
                  className="font-mono text-[10px] uppercase tracking-wide text-r1-accent/70"
                >
                  {label}
                </span>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
