/**
 * AnimatedProcessFlow - Clean pipeline visualization
 * Data flows through 9 stages, skeptic stage highlighted
 */

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Lightbulb, Search, FileSearch, Calculator, Brain,
  Shield, Scale, GitMerge, FileCheck } from
'lucide-react';

const STAGES = [
{ icon: Lightbulb, label: 'Planner' },
{ icon: Search, label: 'Sleuth' },
{ icon: FileSearch, label: 'Retriever' },
{ icon: Calculator, label: 'Quant' },
{ icon: Brain, label: 'Reasoner' },
{ icon: Shield, label: 'Skeptic', isSkeptic: true },
{ icon: Scale, label: 'Synthesizer' },
{ icon: GitMerge, label: 'Verifier' },
{ icon: FileCheck, label: 'Formatter' }];

const TIMINGS = [300, 250, 250, 300, 300, 900, 300, 250, 350];

export function AnimatedProcessFlow() {
  const prefersReducedMotion = useReducedMotion();
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (prefersReducedMotion) {
      setActive(5);
      return;
    }

    const timeoutIds: ReturnType<typeof setTimeout>[] = [];

    const run = () => {
      setActive(-1);
      let delay = 400;

      STAGES.forEach((_, i) => {
        timeoutIds.push(setTimeout(() => setActive(i), delay));
        delay += TIMINGS[i];
      });

      timeoutIds.push(
        setTimeout(() => {
          timeoutIds.push(setTimeout(run, 1500));
        }, delay + 300),
      );
    };

    run();
    return () => timeoutIds.forEach(clearTimeout);
  }, [prefersReducedMotion]);

  const getColor = (i: number, isActive: boolean, isPast: boolean) => {
    if (i === 5) return {
      node: isActive ? 'bg-red-500 border-red-400 shadow-[0_0_25px_rgba(239,68,68,0.6)]' : isPast ? 'bg-red-500/50 border-red-500/40' : 'bg-slate-800 border-slate-700',
      icon: isActive || isPast ? 'text-white' : 'text-slate-500'
    };
    if (i < 5) return {
      node: isActive ? 'bg-cyan-500 border-cyan-400 shadow-[0_0_25px_rgba(34,211,238,0.6)]' : isPast ? 'bg-cyan-500/50 border-cyan-500/40' : 'bg-slate-800 border-slate-700',
      icon: isActive || isPast ? 'text-white' : 'text-slate-500'
    };
    return {
      node: isActive ? 'bg-amber-500 border-amber-400 shadow-[0_0_25px_rgba(251,191,36,0.6)]' : isPast ? 'bg-amber-500/50 border-amber-500/40' : 'bg-slate-800 border-slate-700',
      icon: isActive || isPast ? 'text-white' : 'text-slate-500'
    };
  };

  return (
    <div data-ev-id="ev_76e8fcfc5b" className="w-full py-10">
      <div data-ev-id="ev_cc8ba8979c" className="max-w-5xl mx-auto px-6">
        <div data-ev-id="ev_aab02d7017" className="relative">
          {/* Track */}
          <div data-ev-id="ev_04f94224b2" className="absolute top-6 left-[5%] right-[5%] h-0.5 bg-slate-800" />
          
          {/* Progress */}
          <motion.div
            className="absolute top-6 left-[5%] h-0.5 origin-left"
            style={{
              width: '90%',
              background: active >= 5 ?
              'linear-gradient(90deg, #22D3EE 0%, #22D3EE 50%, #EF4444 55%, #FBBF24 100%)' :
              '#22D3EE'
            }}
            animate={{ scaleX: active >= 0 ? (active + 1) / 9 : 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }} />


          {/* Nodes */}
          <div data-ev-id="ev_79a80114b7" className="relative flex justify-between">
            {STAGES.map((stage, i) => {
              const Icon = stage.icon;
              const isActive = i === active;
              const isPast = i < active;
              const colors = getColor(i, isActive, isPast);

              return (
                <div data-ev-id="ev_1952ff8eb1" key={i} className="flex flex-col items-center gap-2">
                  <motion.div
                    className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center transition-colors ${colors.node}`}
                    animate={{ scale: isActive ? 1.2 : 1, y: isActive ? -6 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
                    <Icon className={`w-5 h-5 ${colors.icon}`} />
                  </motion.div>
                  <span data-ev-id="ev_2a7c58b961" className={`text-[10px] font-mono tracking-wide transition-colors ${
                  isActive ? i === 5 ? 'text-red-400' : i < 5 ? 'text-cyan-400' : 'text-amber-400' :
                  isPast ? 'text-slate-400' : 'text-slate-600'}`
                  }>
                    {stage.label}
                  </span>
                </div>);

            })}
          </div>
        </div>

        {/* Color key */}
        <div data-ev-id="ev_ac82b1718e" className="flex flex-wrap items-center justify-center gap-6 mt-8">
          <div data-ev-id="ev_90b3a5e92f" className="flex items-center gap-2">
            <div data-ev-id="ev_aa7adfda43" className="w-3 h-3 rounded-sm bg-cyan-500" />
            <span data-ev-id="ev_8c210fc14c" className="text-[11px] font-mono text-slate-400">Research & Gathering</span>
          </div>
          <div data-ev-id="ev_6c8990023e" className="flex items-center gap-2">
            <div data-ev-id="ev_81a08f6b38" className="w-3 h-3 rounded-sm bg-red-500" />
            <span data-ev-id="ev_f7584f52ee" className="text-[11px] font-mono text-slate-400">Adversarial Review</span>
          </div>
          <div data-ev-id="ev_709795137c" className="flex items-center gap-2">
            <div data-ev-id="ev_48a805e73f" className="w-3 h-3 rounded-sm bg-amber-500" />
            <span data-ev-id="ev_35cd106187" className="text-[11px] font-mono text-slate-400">Synthesis & Output</span>
          </div>
        </div>
      </div>
    </div>);

}

export default AnimatedProcessFlow;