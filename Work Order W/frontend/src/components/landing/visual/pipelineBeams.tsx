import { motion } from 'framer-motion';
import {
  PIPELINE_EDGES,
  PIPELINE_VIEWBOX,
  PIPELINE_CYCLE_MS,
  PIPELINE_STAGGER_MS,
  PIPELINE_LOOP_PAUSE_MS,
} from './pipelineLayout';
import type { BeamPalette } from './personaBeamPalettes';

/**
 * SVG beam layer — the animated paths between pipeline nodes.
 *
 * Visual design:
 *   - Each edge renders TWO stacked stroked paths:
 *       a) Track (static) — visible at low opacity at all times so the
 *          pipeline structure is perceptible between beam passes.
 *       b) Beam (animated) — bright gradient stroke with animated
 *          `pathLength` (Framer Motion) to create the "light pulse
 *          traveling along the path" effect.
 *   - A wider, lower-opacity "halo" stroke renders UNDERNEATH the bright
 *     beam to fake a glow without SVG filters. Per Rule 27 I-7,
 *     filter-based glows are banned on the critical path.
 *
 * Beams animate sequentially per `edge.seq` with `PIPELINE_STAGGER_MS`
 * spacing. After all 9 edges complete, pause `PIPELINE_LOOP_PAUSE_MS`,
 * then loop.
 *
 * Per Rule 27 I-8: this element is `aria-hidden="true"`. Decorative.
 */

export interface PipelineBeamsProps {
  palette: BeamPalette;
  /** When false, beams do not animate. Used by the IntersectionObserver
   *  gate in `AnimatedPipelineHero`. */
  active: boolean;
}

export default function PipelineBeams({ palette, active }: PipelineBeamsProps) {
  const { width, height } = PIPELINE_VIEWBOX;
  const gradientId = 'r1-beam-gradient';
  const haloGradientId = 'r1-beam-halo-gradient';

  // Per-edge total cycle: time to draw + time to fade + time waiting
  // for the next staggered start. Framer Motion's `repeat: Infinity`
  // with a `repeatDelay` handles the pause cleanly.
  const drawDurationS = (PIPELINE_CYCLE_MS - PIPELINE_LOOP_PAUSE_MS) / 1000;
  const totalLoopS = (PIPELINE_CYCLE_MS + PIPELINE_LOOP_PAUSE_MS) / 1000;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      data-testid="pipeline-beams-svg"
    >
      <defs>
        {/* Gradient that creates the head-to-tail brightness falloff. */}
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"  stopColor={palette.beamTail} />
          <stop offset="60%" stopColor={palette.beamMid} />
          <stop offset="100%" stopColor={palette.beamHead} />
        </linearGradient>

        {/* Halo — same colors, lower opacity, wider stroke. */}
        <linearGradient id={haloGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"  stopColor={palette.beamTail} />
          <stop offset="60%" stopColor={palette.beamMid} stopOpacity={0.35} />
          <stop offset="100%" stopColor={palette.beamHead} stopOpacity={0.5} />
        </linearGradient>
      </defs>

      {/* Static tracks — always visible. */}
      <g>
        {PIPELINE_EDGES.map((edge) => (
          <path
            key={`track-${edge.id}`}
            d={edge.d}
            stroke={palette.trackColor}
            strokeWidth={1.5}
            fill="none"
            strokeLinecap="round"
          />
        ))}
      </g>

      {/* Animated beams — halo + bright stroke per edge. */}
      <g>
        {PIPELINE_EDGES.map((edge) => {
          // Stagger start time so beams flow in sequence.
          const startDelay = (edge.seq * PIPELINE_STAGGER_MS) / 1000;
          return (
            <g key={`beam-${edge.id}`}>
              {/* Halo — wider, dimmer. */}
              <motion.path
                d={edge.d}
                stroke={`url(#${haloGradientId})`}
                strokeWidth={9}
                fill="none"
                strokeLinecap="round"
                style={{ mixBlendMode: 'screen' }}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={
                  active
                    ? {
                        pathLength: [0, 1, 1],
                        opacity: [0, 0.7, 0],
                      }
                    : { pathLength: 0, opacity: 0 }
                }
                transition={{
                  duration: drawDurationS,
                  times: [0, 0.6, 1],
                  delay: startDelay,
                  repeat: Infinity,
                  repeatDelay: Math.max(
                    0,
                    totalLoopS - drawDurationS - startDelay
                  ),
                  ease: 'easeInOut',
                }}
              />
              {/* Bright beam stroke. */}
              <motion.path
                d={edge.d}
                stroke={`url(#${gradientId})`}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={
                  active
                    ? {
                        pathLength: [0, 1, 1],
                        opacity: [0, 1, 0],
                      }
                    : { pathLength: 0, opacity: 0 }
                }
                transition={{
                  duration: drawDurationS,
                  times: [0, 0.6, 1],
                  delay: startDelay,
                  repeat: Infinity,
                  repeatDelay: Math.max(
                    0,
                    totalLoopS - drawDurationS - startDelay
                  ),
                  ease: 'easeInOut',
                }}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
