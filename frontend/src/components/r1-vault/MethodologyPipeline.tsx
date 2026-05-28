/**
 * MethodologyPipeline - Visual pipeline stages for methodology page
 * Shows all 9 stages with emphasis on Skeptic
 */

import { motion } from 'framer-motion';
import { pipelineStages } from '@/content/researchoneUiData';
import {
  BrainCircuit, Search, FileSearch, Calculator,
  Lightbulb, ShieldAlert, Combine, CheckCircle,
  FileText } from
'lucide-react';

const stageIcons: Record<string, typeof BrainCircuit> = {
  planner: BrainCircuit,
  sleuth: Search,
  retriever: FileSearch,
  quantitative: Calculator,
  reasoner: Lightbulb,
  skeptic: ShieldAlert,
  synthesizer: Combine,
  verifier: CheckCircle,
  formatter: FileText
};

export function MethodologyPipeline() {
  return (
    <section data-ev-id="ev_9f95e2608d" className="relative py-20 lg:py-32 bg-r1-canvas">
      <div data-ev-id="ev_e6249cf866" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div data-ev-id="ev_a0ac1533d1" className="w-full mb-16">
          <span data-ev-id="ev_ac1089d04f" className="r1-tag r1-tag-cyan mb-4 inline-flex">
            RESEARCH_METHODOLOGY
          </span>
          <h2 data-ev-id="ev_d1f741f85b" className="text-3xl sm:text-4xl font-bold text-r1-heading leading-tight text-center">
            The nine-stage pipeline
          </h2>
          <p data-ev-id="ev_65f9d76f57" style={{ display: 'block', width: '100%', maxWidth: '800px', margin: '16px auto 0' }} className="text-lg text-r1-muted leading-relaxed text-center">
            Every research objective passes through a multi-agent pipeline where each stage has specialized responsibilities. The Skeptic stage is the key differentiator.
          </p>
        </div>

        {/* Pipeline stages - 3x3 grid on desktop */}
        <div data-ev-id="ev_6b185c04be" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
          {pipelineStages.map((stage, index) => {
            const Icon = stageIcons[stage.id];
            const isSkeptic = stage.isSkeptic;
            const stageNumber = String(index + 1).padStart(2, '0');

            return (
              <motion.div
                key={stage.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.05,
                  ease: [0.25, 1, 0.5, 1]
                }}
                className={`relative p-4 lg:p-5 rounded-lg border transition-all duration-250 ${
                isSkeptic ?
                'bg-r1-red-margin border-r1-skeptic/40 hover:border-r1-skeptic/60 ring-1 ring-r1-skeptic/20 col-span-1 sm:col-span-2 lg:col-span-1' :
                'bg-r1-panel border-r1-border hover:border-r1-border-strong'}`
                }>

                {/* Stage number and icon */}
                <div data-ev-id="ev_250f535ade" className="flex items-center gap-3 mb-3">
                  <span data-ev-id="ev_656687c9b3" className={`font-mono text-xs font-medium ${
                  isSkeptic ? 'text-r1-skeptic' : 'text-r1-muted'}`
                  }>
                    {stageNumber}
                  </span>
                  <div data-ev-id="ev_6934fe4c12" className={`p-2 rounded-lg ${
                  isSkeptic ?
                  'bg-r1-red/20' :
                  index < 5 ?
                  'bg-r1-cyan/10' :
                  'bg-r1-amber/10'}`
                  }>
                    <Icon className={`w-4 h-4 ${
                    isSkeptic ?
                    'text-r1-skeptic' :
                    index < 5 ?
                    'text-r1-cyan' :
                    'text-r1-amber'}`
                    } />
                  </div>
                </div>
                
                {/* Stage name */}
                <h3 data-ev-id="ev_76a40884b7" className={`text-sm font-semibold mb-1.5 ${
                isSkeptic ? 'text-r1-skeptic' : 'text-r1-heading'}`
                }>
                  {stage.name}
                </h3>
                
                {/* Description */}
                <p data-ev-id="ev_4884e77fe2" className="text-xs text-r1-muted leading-relaxed">
                  {stage.description}
                </p>
                
                {/* Skeptic badge */}
                {isSkeptic &&
                <div data-ev-id="ev_23492da6c8" className="absolute -top-2 -right-2">
                    <span data-ev-id="ev_2a83cdc987" className="r1-tag text-[8px] border-r1-skeptic/50 text-r1-skeptic bg-r1-canvas">
                      ADVERSARIAL
                    </span>
                  </div>
                }
              </motion.div>);

          })}
        </div>

        {/* Disclaimer */}
        <div data-ev-id="ev_cd72f40668" className="mt-16 w-full">
          <p data-ev-id="ev_c086f371fd" style={{ display: 'block', width: '100%', maxWidth: '800px', margin: '0 auto' }} className="text-sm text-r1-muted border border-r1-border rounded-lg p-4 bg-r1-panel text-center">
            <strong data-ev-id="ev_76b2f3327f" className="text-r1-amber">Note:</strong> ResearchOne does not claim to detect absolute truth. It structures data, preserves contradictions, and forces conclusions through adversarial review to maximize epistemic quality.
          </p>
        </div>
      </div>
    </section>);

}

export default MethodologyPipeline;