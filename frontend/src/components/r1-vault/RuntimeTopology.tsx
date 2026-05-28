/**
 * RuntimeTopology - Architecture diagram showing production stack
 * Static/decorative display of system topology
 */

import { motion } from 'framer-motion';
import { runtimeTopology } from '@/content/researchoneUiData';
import { Server, Database, Layers, HardDrive, FileOutput } from 'lucide-react';

const layerIcons: Record<string, typeof Server> = {
  Frontend: Layers,
  Backend: Server,
  Queue: HardDrive,
  Corpus: Database,
  Exports: FileOutput
};

export function RuntimeTopology() {
  return (
    <section data-ev-id="ev_cee1beb57c" className="relative py-20 lg:py-32 bg-r1-canvas border-t border-r1-border">
      <div data-ev-id="ev_fd86a2a2b8" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div data-ev-id="ev_9ce264e0c2" className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: Description */}
          <div data-ev-id="ev_08e11d8e21">
            <span data-ev-id="ev_42316819fc" className="r1-tag mb-4 inline-flex">
              RUNTIME_TOPOLOGY
            </span>
            <h2 data-ev-id="ev_f6258f5dbd" className="text-3xl sm:text-4xl font-bold text-r1-heading leading-tight">
              Production-grade infrastructure
            </h2>
            <p data-ev-id="ev_ef569f8d24" className="mt-4 text-xl text-r1-muted leading-relaxed">
              ResearchOne runs on a distributed architecture designed for reliability, 
              scalability, and real-time research monitoring.
            </p>
            <p data-ev-id="ev_08370bd90c" className="mt-4 text-lg text-r1-muted leading-relaxed">
              Frontend served from the edge. Backend orchestrates multi-agent pipelines. 
              Vector search powers semantic retrieval. Every component built for research-grade 
              evidence handling.
            </p>
            
            {/* Status badges */}
            <div data-ev-id="ev_f726318f87" className="mt-8 flex flex-wrap gap-3">
              <span data-ev-id="ev_0d8a1da97f" className="r1-tag r1-tag-green">
                <span data-ev-id="ev_0781ca9a91" className="w-1.5 h-1.5 rounded-full bg-r1-green animate-pulse" />
                ALL SYSTEMS ONLINE
              </span>
              <span data-ev-id="ev_2490d3df5f" className="r1-tag">
                99.9% UPTIME SLA
              </span>
            </div>
          </div>

          {/* Right: Topology diagram */}
          <div data-ev-id="ev_3406618f40" className="relative">
            <div data-ev-id="ev_f90a888220" className="r1-panel p-6 lg:p-8">
              {/* Header */}
              <div data-ev-id="ev_0d3fd3172b" className="flex items-center justify-between mb-6 pb-4 border-b border-r1-border">
                <span data-ev-id="ev_23de226ec8" className="r1-mono-label text-[10px]">SYSTEM_ARCHITECTURE</span>
                <span data-ev-id="ev_18b2518c73" className="r1-mono-label text-[10px] text-r1-green">HEALTHY</span>
              </div>
              
              {/* Topology nodes */}
              <div data-ev-id="ev_ef3a30ceac" className="flex flex-col gap-4">
                {runtimeTopology.map((node, index) => {
                  const Icon = layerIcons[node.layer] || Server;
                  const isFirst = index === 0;
                  const isLast = index === runtimeTopology.length - 1;

                  return (
                    <motion.div
                      key={node.layer}
                      initial={{ opacity: 0, x: -10 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: index * 0.1 }}
                      className="relative">

                      <div data-ev-id="ev_37fa1abc98" className="flex items-center gap-4 p-4 rounded-lg bg-r1-panel-lift border border-r1-border hover:border-r1-border-strong transition-colors duration-200">
                        {/* Icon */}
                        <div data-ev-id="ev_63795663b2" className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg ${
                        isFirst ? 'bg-r1-cyan/10' : 'bg-r1-panel'}`
                        }>
                          <Icon className={`w-5 h-5 ${
                          isFirst ? 'text-r1-cyan' : 'text-r1-muted'}`
                          } />
                        </div>
                        
                        {/* Content */}
                        <div data-ev-id="ev_72f3a01302" className="flex-1 min-w-0">
                          <div data-ev-id="ev_00614839c7" className="flex items-center gap-2">
                            <span data-ev-id="ev_7783c0bad6" className="r1-mono-label text-[10px] text-r1-dim">
                              {node.layer.toUpperCase()}
                            </span>
                          </div>
                          <div data-ev-id="ev_323aee6f78" className="text-sm font-medium text-r1-heading mt-0.5 leading-snug">
                            {node.name}
                          </div>
                          <div data-ev-id="ev_36cfe88918" className="text-sm text-r1-muted mt-1.5 leading-relaxed">
                            {node.description}
                          </div>
                        </div>
                        
                        {/* Status indicator */}
                        <div data-ev-id="ev_718b19115c" className="flex-shrink-0">
                          <span data-ev-id="ev_265df10357" className="w-2 h-2 rounded-full bg-r1-green" />
                        </div>
                      </div>
                      
                      {/* Connection line */}
                      {!isLast &&
                      <div data-ev-id="ev_039f95911e"
                      className="absolute left-7 bottom-0 translate-y-full w-px h-4 bg-gradient-to-b from-r1-border-strong to-r1-border"
                      aria-hidden="true" />

                      }
                    </motion.div>);

                })}
              </div>
              
              {/* Footer */}
              <div data-ev-id="ev_e0daff75fe" className="mt-6 pt-4 border-t border-r1-border flex items-center justify-between">
                <span data-ev-id="ev_8d6cd2c183" className="r1-mono-label text-[9px] text-r1-dim">
                  VERCEL + EMMA SPLIT DEPLOYMENT
                </span>
                <span data-ev-id="ev_1cbe7b9b0c" className="r1-mono-label text-[9px] text-r1-cyan">
                  v2.4.1
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>);

}

export default RuntimeTopology;