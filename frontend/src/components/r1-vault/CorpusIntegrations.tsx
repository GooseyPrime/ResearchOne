/**
 * CorpusIntegrations - Professional data sources showcase
 * Displays the corpus and integration sources ResearchOne pulls from
 * Critical for credibility - shows professional/academic data sources
 */

import { motion, useReducedMotion } from 'framer-motion';
import { Database, BookOpen, FlaskConical, FileText, Stethoscope } from 'lucide-react';

// Data source definitions with icons and metadata
const corpusSources = [
{
  id: 'scite',
  name: 'Scite.ai',
  description: 'Smart citation context analysis',
  icon: BookOpen,
  category: 'Citation Intelligence'
},
{
  id: 'pubmed',
  name: 'PubMed Central',
  description: 'Biomedical & life sciences literature',
  icon: Stethoscope,
  category: 'Medical Research'
},
{
  id: 'arxiv',
  name: 'arXiv',
  description: 'Pre-print scientific papers',
  icon: FlaskConical,
  category: 'Scientific Pre-prints'
},
{
  id: 'uspto',
  name: 'USPTO Patents',
  description: 'United States patent database',
  icon: FileText,
  category: 'Intellectual Property'
},
{
  id: 'clinicaltrials',
  name: 'ClinicalTrials.gov',
  description: 'Clinical study registry & results',
  icon: Database,
  category: 'Clinical Research'
}];


export function CorpusIntegrations() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section data-ev-id="ev_af54f52aae" className="relative py-16 lg:py-24 bg-r1-canvas-deep border-y border-r1-border">
      {/* Subtle grid background */}
      <div data-ev-id="ev_f12026a2b2"
      className="absolute inset-0 opacity-[0.02] pointer-events-none"
      aria-hidden="true"
      style={{
        backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
        backgroundSize: '40px 40px'
      }} />


      <div data-ev-id="ev_d4f0340edd" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section header */}
        <div data-ev-id="ev_45bd0b5174" className="w-full mb-12">
          <span data-ev-id="ev_6c3e3ccb74" className="r1-tag r1-tag-cyan mb-4 inline-flex">
            CORPUS_INTEGRATIONS
          </span>
          <h2 data-ev-id="ev_565170ee72" className="text-2xl sm:text-3xl font-bold text-r1-heading leading-tight mb-3">
            Professional-grade data sources
          </h2>
          <p data-ev-id="ev_d916a0ce82" style={{ display: 'block', width: '100%', maxWidth: '900px' }} className="text-r1-muted text-lg leading-relaxed">
            ResearchOne retrieves and cross-references findings from leading academic and institutional databases to ensure comprehensive, citation-backed analysis.
          </p>
        </div>

        {/* Sources grid */}
        <div data-ev-id="ev_3407b2150d" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {corpusSources.map((source, index) => {
            const Icon = source.icon;
            return (
              <motion.div
                key={source.id}
                initial={prefersReducedMotion ? {} : { opacity: 0, y: 20 }}
                whileInView={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.4, delay: index * 0.08 }}
                className="group relative p-5 rounded-lg border border-r1-border bg-r1-panel/50 hover:border-r1-border-strong hover:bg-r1-panel transition-all duration-200">

                {/* Icon */}
                <div data-ev-id="ev_027f6ea5b2" className="w-10 h-10 rounded-lg bg-r1-cyan/10 border border-r1-cyan/20 flex items-center justify-center mb-4 group-hover:bg-r1-cyan/15 transition-colors">
                  <Icon className="w-5 h-5 text-r1-cyan" />
                </div>

                {/* Content */}
                <h3 data-ev-id="ev_a73a0cceda" className="text-sm font-semibold text-r1-heading mb-1">
                  {source.name}
                </h3>
                <p data-ev-id="ev_415d4f72e7" className="text-xs text-r1-muted leading-relaxed">
                  {source.description}
                </p>

                {/* Category tag */}
                <span data-ev-id="ev_002a4f2dc3" className="mt-3 inline-block text-[9px] font-mono tracking-wider text-r1-muted/60 uppercase">
                  {source.category}
                </span>
              </motion.div>);

          })}
        </div>

        {/* Bottom note */}
        <p data-ev-id="ev_d860d38112" className="mt-8 text-center text-xs text-r1-muted/60 font-mono">
          CORPUS_STATUS: ACTIVE · RETRIEVAL_MODE: HYBRID · CORROBORATION: MULTI_SOURCE
        </p>
      </div>
    </section>);

}

export default CorpusIntegrations;