/**
 * LandingPage - ResearchOne public landing page
 * Complete marketing experience with hero, capabilities, vault core, and topology
 */

import { R1Shell } from '@/components/r1-shell/R1Shell';
import { VaultHero } from '@/components/r1-vault/VaultHero';
import { ProtocolMarquee } from '@/components/r1-vault/ProtocolMarquee';
import { CapabilityShowcase } from '@/components/r1-vault/CapabilityShowcase';
import { StickyVaultCore } from '@/components/r1-vault/StickyVaultCore';
import { CorpusIntegrations } from '@/components/r1-vault/CorpusIntegrations';
import { RuntimeTopology } from '@/components/r1-vault/RuntimeTopology';
import { Link } from 'react-router-dom';
import { ChevronRight, FileText } from 'lucide-react';

export default function LandingPage() {
  return (
    <R1Shell variant="public">
      {/* Hero section */}
      <VaultHero />
      
      {/* Protocol marquee */}
      <ProtocolMarquee />
      
      {/* Capability showcase */}
      <CapabilityShowcase />
      
      {/* Corpus & data source integrations */}
      <CorpusIntegrations />
      
      {/* Sticky vault core with feature blocks */}
      <StickyVaultCore />
      
      {/* Runtime topology */}
      <RuntimeTopology />
      
      {/* Final CTA section */}
      <section data-ev-id="ev_0e12777fc9" className="relative py-20 lg:py-32 bg-r1-canvas border-t border-r1-border">
        <div data-ev-id="ev_4164006043" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <span data-ev-id="ev_091561049f" className="r1-tag r1-tag-cyan mb-4 inline-flex">
            READY_TO_START
          </span>
          <h2 data-ev-id="ev_1527402fb9" className="text-3xl sm:text-4xl font-bold text-r1-heading leading-tight mb-4">
            Research that defends itself.
          </h2>
          <p data-ev-id="ev_856644994c" className="text-xl text-r1-muted leading-relaxed mb-8">
            Start your first multi-agent research run and see how adversarial review 
            transforms raw queries into citation-backed dossiers.
          </p>
          <div data-ev-id="ev_72b490abe2" className="flex flex-wrap justify-center gap-4">
            <Link
              to="/sign-up"
              className="inline-flex items-center gap-2 px-8 py-4 text-lg font-semibold bg-r1-cyan text-r1-canvas rounded hover:bg-r1-cyan/90 transition-all duration-200 r1-focus-ring r1-glow-cyan">

              Start Research
              <ChevronRight className="w-5 h-5" />
            </Link>
            <Link
              to="/sample-report"
              className="inline-flex items-center gap-2 px-8 py-4 text-lg font-medium text-r1-text bg-r1-panel border border-r1-border rounded hover:bg-r1-panel-lift hover:border-r1-border-strong transition-all duration-200 r1-focus-ring">

              <FileText className="w-5 h-5" />
              View Sample Report
            </Link>
          </div>
        </div>
      </section>
    </R1Shell>);

}