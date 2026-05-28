/**
 * VaultHero - Landing page hero - SIMPLIFIED FOR DEBUGGING
 */

import { Link } from 'react-router-dom';
import { ChevronRight, FileText, Play } from 'lucide-react';
import { AnimatedProcessFlow } from './AnimatedProcessFlow';

export function VaultHero() {
  return (
    <section data-ev-id="ev_a6dabb2a63" className="block w-full min-h-screen pt-20 overflow-hidden bg-r1-canvas">
      {/* Background grid */}
      <div data-ev-id="ev_ab657786ab" className="absolute inset-0 opacity-[0.03] pointer-events-none" aria-hidden="true">
        <div data-ev-id="ev_2183fbb571"
        className="h-full w-full"
        style={{
          backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '60px 60px'
        }} />

      </div>

      {/* Content */}
      <div data-ev-id="ev_71fb83a35d" className="block w-full relative z-10">
        {/* Hero text area */}
        <div data-ev-id="ev_f6ab015566" className="block w-full" style={{ maxWidth: '1280px', marginLeft: 'auto', marginRight: 'auto', paddingLeft: '24px', paddingRight: '24px', paddingTop: '64px' }}>
          {/* Tag */}
          <div data-ev-id="ev_001ed4b74d" className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 text-[11px] font-mono font-medium tracking-wider text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 rounded">
            <span data-ev-id="ev_f2cc7195fc" className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            MULTI_AGENT_PIPELINE
          </div>

          {/* Headline */}
          <h1 data-ev-id="ev_9e3b6c90e6" style={{ display: 'block', width: '100%' }} className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-white leading-[1.05] tracking-tight">
            Research that <span data-ev-id="ev_56d335c79d" className="text-cyan-400">maps</span> the whole landscape.
          </h1>

          {/* Subheadline */}
          <p data-ev-id="ev_6aa5c818fd" style={{ display: 'block', width: '100%', maxWidth: '768px' }} className="mt-6 text-lg sm:text-xl lg:text-2xl text-slate-400 leading-relaxed">
            A multi-agent deep research system that explores every angle, tests its own conclusions, and preserves contradictions—giving you a complete, citation-backed picture, not just the consensus.
          </p>

          {/* CTAs */}
          <div data-ev-id="ev_e859b6de4d" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '16px', marginTop: '40px' }}>
            <Link
              to="/sample-report"
              className="inline-flex items-center gap-2 px-7 py-4 text-base font-semibold bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 transition-colors">
              <FileText className="w-5 h-5" />
              Open a Sample Report
            </Link>
            <Link
              to="/methodology"
              className="inline-flex items-center gap-2 px-7 py-4 text-base font-medium text-slate-200 bg-slate-800/80 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors">
              <Play className="w-5 h-5" />
              Explore the Methodology
            </Link>
            <Link
              to="/sign-up"
              className="inline-flex items-center gap-2 px-5 py-4 text-base font-medium text-slate-400 hover:text-white transition-colors">
              Start Research
              <ChevronRight className="w-5 h-5" />
            </Link>
          </div>
        </div>

        {/* Pipeline visualization */}
        <div data-ev-id="ev_df90aa7770" className="w-full mt-16 lg:mt-20 pb-16">
          <AnimatedProcessFlow />
        </div>
      </div>
    </section>);

}

export default VaultHero;