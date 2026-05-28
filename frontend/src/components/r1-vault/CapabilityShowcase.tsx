/**
 * CapabilityShowcase - Feature cards grid
 * Premium interactive panels highlighting platform capabilities
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import * as LucideIcons from 'lucide-react';
import { capabilities } from '@/content/researchoneUiData';
import type { LucideIcon } from 'lucide-react';

// Dynamic icon resolver
function getIcon(iconName: string): LucideIcon {
  const icons = LucideIcons as unknown as Record<string, LucideIcon>;
  return icons[iconName] || LucideIcons.Box;
}

export function CapabilityShowcase() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <section data-ev-id="ev_48a063e43a" className="relative py-20 lg:py-32 bg-r1-canvas">
      <div data-ev-id="ev_354e8a4803" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div data-ev-id="ev_22b4e1ae2b" style={{ display: 'block', width: '100%', maxWidth: '900px' }} className="mb-16">
          <span data-ev-id="ev_b6c5bef5bc" className="r1-tag r1-tag-amber mb-4 inline-flex">
            CAPABILITY_MATRIX
          </span>
          <h2 data-ev-id="ev_2d6906b416" className="text-3xl sm:text-4xl font-bold text-r1-heading leading-tight">
            Research infrastructure, <span data-ev-id="ev_7ffe75d83c" className="text-r1-cyan">not a chatbot</span>
          </h2>
          <p data-ev-id="ev_fe49bc6f77" style={{ display: 'block', width: '100%' }} className="mt-4 text-xl text-r1-muted leading-relaxed">
            Every component engineered for evidence quality, not speed of response.
          </p>
        </div>

        {/* Capability grid - 2 columns max for readable text */}
        <div data-ev-id="ev_ce9b901ea6" className="grid sm:grid-cols-2 gap-5 lg:gap-8">
          {capabilities.map((capability, index) => {
            const Icon = getIcon(capability.icon);
            const isHovered = hoveredId === capability.id;
            const isSkeptic = capability.id === 'skeptic';

            return (
              <motion.div
                key={capability.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.05,
                  ease: [0.25, 1, 0.5, 1]
                }}
                onMouseEnter={() => setHoveredId(capability.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`group relative p-8 rounded-lg border transition-all duration-250 ${
                isHovered ?
                'bg-r1-panel-lift border-r1-border-strong' :
                'bg-r1-panel border-r1-border'} ${

                isSkeptic ? 'ring-1 ring-r1-skeptic/20' : ''}`
                }
                style={{ transitionTimingFunction: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>

                {/* Icon */}
                <div data-ev-id="ev_67afc0f37a" className={`inline-flex p-3 rounded-lg mb-4 transition-colors duration-250 ${
                isSkeptic ?
                'bg-r1-red-margin' :
                isHovered ?
                'bg-r1-cyan/10' :
                'bg-r1-panel-lift'}`
                }>
                  <Icon className={`w-5 h-5 ${
                  isSkeptic ?
                  'text-r1-skeptic' :
                  isHovered ?
                  'text-r1-cyan' :
                  'text-r1-muted'} transition-colors duration-250`
                  } />
                </div>
                
                {/* Title */}
                <h3 data-ev-id="ev_03bb716a12" className={`text-lg font-semibold mb-3 leading-snug transition-colors duration-250 ${
                isSkeptic ? 'text-r1-skeptic' : 'text-r1-heading'}`
                }>
                  {capability.title}
                </h3>
                
                {/* Description */}
                <p data-ev-id="ev_df03dc7288" className="text-base text-r1-muted leading-relaxed">
                  {capability.description}
                </p>
                
                {/* Corner accent */}
                <div data-ev-id="ev_d1a6c128fe"
                className={`absolute top-0 right-0 w-16 h-16 pointer-events-none transition-opacity duration-250 ${
                isHovered ? 'opacity-100' : 'opacity-0'}`
                }
                aria-hidden="true">

                  <div data-ev-id="ev_d7acf0c1bb" className={`absolute top-3 right-3 w-1.5 h-1.5 rounded-full ${
                  isSkeptic ? 'bg-r1-skeptic' : 'bg-r1-cyan'}`
                  } />
                </div>
              </motion.div>);

          })}
        </div>
      </div>
    </section>);

}

export default CapabilityShowcase;