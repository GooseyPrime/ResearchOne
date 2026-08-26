/**
 * FeatureVaultList - Numbered feature blocks for vault section
 * Each block represents a pipeline stage with technical metadata
 */

import { motion } from 'framer-motion';
import { featureBlocks } from '@/content/researchoneUiData';

export function FeatureVaultList() {
  return (
    <div data-ev-id="ev_6db60ab02c" className="flex flex-col gap-6">
      {featureBlocks.map((feature, index) => {
        const isSkeptic = feature.isSkeptic || feature.number === '06';

        return (
          <motion.div
            key={feature.number}
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{
              duration: 0.5,
              delay: index * 0.05,
              ease: [0.25, 1, 0.5, 1]
            }}
            className={`relative p-6 rounded-lg border transition-colors duration-250 ${
            isSkeptic ?
            'bg-r1-red-margin border-r1-challenge/30 hover:border-r1-challenge/50' :
            'bg-r1-panel border-r1-border hover:border-r1-border-strong'}`
            }>

            {/* Number badge */}
            <div data-ev-id="ev_1683730318" className="flex items-start gap-4">
              <span data-ev-id="ev_9f68888c48" className={`flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-lg font-mono text-lg font-semibold ${
              isSkeptic ?
              'bg-r1-red/20 text-r1-challenge' :
              index < 5 ?
              'bg-r1-cyan/10 text-r1-cyan' :
              'bg-r1-amber/10 text-r1-amber'}`
              }>
                {feature.number}
              </span>
              
              <div data-ev-id="ev_68e6d36103" className="flex-1 min-w-0">
                {/* Title row */}
                <div data-ev-id="ev_fa77225fcd" className="flex items-center gap-3 flex-wrap mb-1">
                  <h3 data-ev-id="ev_ac1257d3b7" className={`text-lg font-semibold ${
                  isSkeptic ? 'text-r1-challenge' : 'text-r1-heading'}`
                  }>
                    {feature.title}
                  </h3>
                  {isSkeptic &&
                  <span data-ev-id="ev_5530b71ead" className="r1-tag text-[9px] border-r1-challenge/50 text-r1-challenge">
                      CHALLENGE
                    </span>
                  }
                </div>
                
                {/* Subtitle - technical metadata */}
                <div data-ev-id="ev_35351ac685" className="r1-mono-label text-[10px] text-r1-dim mb-3">
                  {feature.subtitle}
                </div>
                
                {/* Description */}
                <p data-ev-id="ev_018e24e8d2" className="text-base text-r1-muted leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </div>
            
            {/* Connecting line to next item */}
            {index < featureBlocks.length - 1 &&
            <div data-ev-id="ev_b84dbe8565"
            className="absolute left-[2.25rem] bottom-0 translate-y-full w-px h-6 bg-gradient-to-b from-r1-border to-transparent"
            aria-hidden="true" />

            }
          </motion.div>);

      })}
    </div>);

}

export default FeatureVaultList;