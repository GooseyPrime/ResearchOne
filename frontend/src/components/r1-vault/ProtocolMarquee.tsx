/**
 * ProtocolMarquee - Terminal-style scrolling protocol strip
 * Refined security readout aesthetic
 */

import { useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { protocolLabels, operationalPhrases } from '@/content/researchoneUiData';

export function ProtocolMarquee() {
  const prefersReducedMotion = useReducedMotion();
  const [isPaused, setIsPaused] = useState(false);
  const marqueeRef = useRef<HTMLDivElement>(null);

  // Combine labels for full marquee content
  const allLabels = [...protocolLabels, ...operationalPhrases.slice(0, 5)];

  // Duplicate for seamless loop
  const marqueeContent = [...allLabels, ...allLabels];

  return (
    <section data-ev-id="ev_952acec680" className="relative py-8 border-y border-r1-border bg-r1-canvas-deep overflow-hidden">
      {/* Gradient masks */}
      <div data-ev-id="ev_908d27ce00"
      className="absolute left-0 top-0 bottom-0 w-20 sm:w-32 z-10 pointer-events-none"
      style={{ background: 'linear-gradient(to right, #060810, transparent)' }}
      aria-hidden="true" />

      <div data-ev-id="ev_be0573b752"
      className="absolute right-0 top-0 bottom-0 w-20 sm:w-32 z-10 pointer-events-none"
      style={{ background: 'linear-gradient(to left, #060810, transparent)' }}
      aria-hidden="true" />

      
      <div data-ev-id="ev_046c4034d1"
      ref={marqueeRef}
      className="relative flex gap-8 whitespace-nowrap"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      style={{
        animation: prefersReducedMotion || isPaused ?
        'none' :
        'r1-marquee 40s linear infinite'
      }}>

        {marqueeContent.map((label, i) => {
          const pos = i % allLabels.length;
          const isOperational = pos >= protocolLabels.length;
          // The marquee's emphasised stage. This compared against 'SKEPTIC'
          // until the label itself was renamed, at which point the comparison
          // stopped matching anything and the emphasis silently disappeared —
          // a label rename that took a behaviour with it.
          const isChallenge = label === 'CHALLENGE';

          return (
            <span data-ev-id="ev_88411fd3ca"
            key={`${label}-${i}`}
            className={`inline-flex items-center gap-3 px-4 py-2 font-mono text-xs tracking-wider ${
            isChallenge ?
            'text-r1-challenge' :
            isOperational ?
            'text-r1-green' :
            'text-r1-muted'}`
            }>

              <span data-ev-id="ev_8af012abfc"
              className={`w-1.5 h-1.5 rounded-full ${
              isChallenge ?
              'bg-r1-challenge' :
              isOperational ?
              'bg-r1-green animate-pulse' :
              'bg-r1-cyan'}`
              } />

              {label}
            </span>);

        })}
      </div>
      
      {/* CSS animation keyframes */}
      <style data-ev-id="ev_307241c036">{`
        @keyframes r1-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        
        @media (prefers-reduced-motion: reduce) {
          .r1-marquee-animate {
            animation: none !important;
          }
        }
      `}</style>
    </section>);

}

export default ProtocolMarquee;