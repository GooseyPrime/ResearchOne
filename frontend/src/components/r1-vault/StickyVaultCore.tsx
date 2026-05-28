/**
 * StickyVaultCore - Feature section with pipeline stages
 * Desktop: sticky visualization with scrolling feature blocks
 * Mobile: standard stacked layout
 */

import { useRef, useState, useEffect } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { FeatureVaultList } from './FeatureVaultList';
import { pipelineStages } from '@/content/researchoneUiData';

export function StickyVaultCore() {
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end']
  });

  const maxStageIndex = pipelineStages.length - 1;

  // Map scroll progress to active stage (indexes 0..length-1)
  const activeStage = useTransform(scrollYProgress, [0, 1], [0, maxStageIndex]);

  useEffect(() => {
    return activeStage.on('change', (v) => {
      const next = Math.round(v);
      setActiveIndex(Math.min(maxStageIndex, Math.max(0, next)));
    });
  }, [activeStage, maxStageIndex]);

  return (
    <section data-ev-id="ev_225dc73099"
    ref={containerRef}
    className="relative bg-slate-950">

      {/* Section header */}
      <div data-ev-id="ev_e0f0160f75" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-20 lg:pt-32 pb-12">
        <div data-ev-id="ev_f8264602c5" style={{ display: 'block', width: '100%', maxWidth: '900px' }}>
          <span data-ev-id="ev_71a45ee7f9" className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono font-medium tracking-wider text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 rounded mb-4">
            PIPELINE_ARCHITECTURE
          </span>
          <h2 data-ev-id="ev_0624e8cc08" className="text-3xl sm:text-4xl font-bold text-white leading-tight">
            Ten-stage adversarial pipeline
          </h2>
          <p data-ev-id="ev_6350d2a197" style={{ display: 'block', width: '100%' }} className="mt-4 text-xl text-slate-400 leading-relaxed">
            Every research objective passes through a multi-agent pipeline designed to challenge assumptions and strengthen conclusions.
          </p>
        </div>
      </div>

      {/* Main content area */}
      <div data-ev-id="ev_51d4c9e931" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-20 lg:pb-32">
        <div data-ev-id="ev_b287aa1b03" className="lg:grid lg:grid-cols-[380px_1fr] lg:gap-20 items-start">
          {/* Left: Sticky stage indicator (desktop only) */}
          <div data-ev-id="ev_5594523175" className="hidden lg:block">
            <div data-ev-id="ev_e3885dcdc2" className="sticky top-24">
              {/* Circular stage diagram */}
              <div data-ev-id="ev_8e565cd7f6" className="relative w-full max-w-md mx-auto aspect-square">
                {/* Glow */}
                <div data-ev-id="ev_cca6206777"
                className="absolute inset-0 rounded-full blur-3xl opacity-30"
                style={{
                  background: 'radial-gradient(circle, rgba(99, 230, 255, 0.3) 0%, rgba(246, 180, 81, 0.15) 50%, transparent 70%)'
                }} />

                
                <svg data-ev-id="ev_828a8f8965" viewBox="0 0 400 400" className="w-full h-full">
                  <defs data-ev-id="ev_0c20dd6812">
                    <radialGradient data-ev-id="ev_2171dc1c52" id="coreGradient" cx="50%" cy="50%" r="50%">
                      <stop data-ev-id="ev_506c52a0a6" offset="0%" stopColor="#1E293B" />
                      <stop data-ev-id="ev_c095013579" offset="100%" stopColor="#0F172A" />
                    </radialGradient>
                    <filter data-ev-id="ev_97a082fea9" id="nodeGlow">
                      <feGaussianBlur data-ev-id="ev_0e7f9c42d9" stdDeviation="4" result="blur" />
                      <feMerge data-ev-id="ev_90d5d03e2c">
                        <feMergeNode data-ev-id="ev_4329c99697" in="blur" />
                        <feMergeNode data-ev-id="ev_5acdda671f" in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Outer rings */}
                  <circle data-ev-id="ev_c467f9e218" cx="200" cy="200" r="185" fill="none" stroke="#334155" strokeWidth="1" opacity="0.3" />
                  <circle data-ev-id="ev_46a0672121" cx="200" cy="200" r="160" fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="4 4" opacity="0.2" />
                  
                  {/* Connection lines */}
                  {pipelineStages.map((_, i) => {
                    const angle = (i * 36 - 90) * (Math.PI / 180);
                    const x = 200 + 170 * Math.cos(angle);
                    const y = 200 + 170 * Math.sin(angle);
                    const isActive = i === activeIndex;
                    const isSkeptic = i === 5;
                    const color = isSkeptic ? '#EF4444' : i < 5 ? '#22D3EE' : '#FBBF24';

                    return (
                      <line data-ev-id="ev_2c2251db98"
                      key={`line-${i}`}
                      x1={x} y1={y} x2="200" y2="200"
                      stroke={color}
                      strokeWidth={isActive ? 2 : 1}
                      opacity={isActive ? 0.6 : 0.15} />);


                  })}

                  {/* Stage nodes */}
                  {pipelineStages.map((stage, i) => {
                    const angle = (i * 36 - 90) * (Math.PI / 180);
                    const x = 200 + 170 * Math.cos(angle);
                    const y = 200 + 170 * Math.sin(angle);
                    const isActive = i === activeIndex;
                    const isPast = i < activeIndex;
                    const isSkeptic = stage.isSkeptic;
                    const color = isSkeptic ? '#EF4444' : i < 5 ? '#22D3EE' : '#FBBF24';

                    return (
                      <g data-ev-id="ev_efe6483a2b" key={stage.id} filter={isActive ? 'url(#nodeGlow)' : undefined}>
                        {/* Outer ring */}
                        <circle data-ev-id="ev_e0b2a1810b"
                        cx={x} cy={y}
                        r={isSkeptic ? 18 : 14}
                        fill="none"
                        stroke={color}
                        strokeWidth={isActive ? 2 : 1}
                        opacity={isActive ? 0.9 : isPast ? 0.6 : 0.3}>

                          {isActive && !prefersReducedMotion &&
                          <animate data-ev-id="ev_362b207aea"
                          attributeName="r"
                          values={isSkeptic ? '18;24;18' : '14;20;14'}
                          dur="1.5s"
                          repeatCount="indefinite" />

                          }
                        </circle>
                        
                        {/* Inner fill */}
                        <circle data-ev-id="ev_ba4a94e540"
                        cx={x} cy={y}
                        r={isSkeptic ? 10 : 7}
                        fill={color}
                        opacity={isActive ? 1 : isPast ? 0.7 : 0.4} />

                        
                        {/* Stage number */}
                        <text data-ev-id="ev_f6cb52c2fc"
                        x={x} y={y + 32}
                        textAnchor="middle"
                        className="text-[9px] font-mono"
                        fill={isActive ? color : '#64748B'}>

                          {String(i + 1).padStart(2, '0')}
                        </text>
                      </g>);

                  })}

                  {/* Center core */}
                  <circle data-ev-id="ev_1f66cbe3e4" cx="200" cy="200" r="50" fill="url(#coreGradient)" />
                  <circle data-ev-id="ev_7ad7b1780e" cx="200" cy="200" r="55" fill="none" stroke="#22D3EE" strokeWidth="1" opacity="0.4" />
                  
                  {/* Center text */}
                  <text data-ev-id="ev_3a7b3bc462" x="200" y="196" textAnchor="middle" className="text-[10px] font-mono" fill="#64748B">
                    VAULT
                  </text>
                  <text data-ev-id="ev_814b3d0bef" x="200" y="210" textAnchor="middle" className="text-[10px] font-mono font-medium" fill="#22D3EE">
                    CORE
                  </text>
                </svg>

                {/* Active stage label */}
                <div data-ev-id="ev_96f37a1b94" className="absolute bottom-0 left-0 right-0 text-center">
                  <motion.div
                    key={activeIndex}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="inline-flex flex-col items-center">

                    <span data-ev-id="ev_9b955a448a" className="font-mono text-[10px] text-slate-500 tracking-wider">
                      ACTIVE_STAGE
                    </span>
                    <span data-ev-id="ev_2f09a7593c" className={`font-mono text-sm font-medium tracking-wider ${
                    pipelineStages[activeIndex]?.isSkeptic ?
                    'text-red-400' :
                    activeIndex < 5 ?
                    'text-cyan-400' :
                    'text-amber-400'}`
                    }>
                      {pipelineStages[activeIndex]?.name?.toUpperCase() ?? ''}
                    </span>
                  </motion.div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Feature blocks */}
          <div data-ev-id="ev_1c28b2e12d">
            <FeatureVaultList />
          </div>
        </div>
      </div>
    </section>);

}

export default StickyVaultCore;