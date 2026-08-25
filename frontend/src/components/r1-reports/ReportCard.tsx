/**
 * ReportCard - Card component for reports/dossiers list
 */

import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Download, ChevronRight, AlertTriangle, CheckCircle } from 'lucide-react';
import { evidenceTierMeta } from '@/content/researchoneUiData';
import { buildExportUrl } from '@/lib/researchone/exportLinks';
import type { Report } from '@/lib/researchone/types';

interface ReportCardProps {
  report: Report;
  index?: number;
}

export function ReportCard({ report, index = 0 }: ReportCardProps) {
  const tierMeta = evidenceTierMeta[report.evidenceTier];
  const hasContradictions = report.contradictionCount > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="r1-panel hover:border-r1-border-strong transition-colors duration-200">

      <div data-ev-id="ev_aeacf2228b" className="p-6">
        {/* Header */}
        <div data-ev-id="ev_05a02523cd" className="flex items-start justify-between gap-3 mb-3">
          <div data-ev-id="ev_34340b9db7" className="flex flex-wrap items-center gap-1.5">
            <span data-ev-id="ev_172c10e84b" className={`r1-tag text-[9px] ${
            tierMeta.color === 'cyan' ? 'r1-tag-cyan' :
            tierMeta.color === 'green' ? 'r1-tag-green' :
            tierMeta.color === 'amber' ? 'r1-tag-amber' :
            tierMeta.color === 'red' ? 'border-r1-challenge/50 text-r1-challenge' : ''}`
            }>
              {tierMeta.label.toUpperCase()}
            </span>
            <span data-ev-id="ev_664f0be8ef" className={`r1-tag text-[9px] ${
            report.status === 'published' ? 'r1-tag-green' :
            report.status === 'draft' ? 'r1-tag-amber' : ''}`
            }>
              {report.status.toUpperCase()}
            </span>
          </div>
          <span data-ev-id="ev_17b3e4ff43" className="r1-mono-label text-[9px] text-r1-dim">
            {report.id.toUpperCase()}
          </span>
        </div>
        
        {/* Title */}
        <h3 data-ev-id="ev_ff21bf16d7" className="text-lg font-semibold text-r1-heading mb-3 leading-snug">
          {report.title}
        </h3>
        
        {/* Metrics */}
        <div data-ev-id="ev_83d447ade6" className="flex flex-wrap items-center gap-3 text-xs text-r1-muted mb-4">
          <div data-ev-id="ev_9549689935" className="flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5 text-r1-cyan" />
            <span data-ev-id="ev_113cd65ee8">{report.citationCount} citations</span>
          </div>
          {hasContradictions &&
          <div data-ev-id="ev_bce8f5bb16" className="flex items-center gap-1 text-r1-amber">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span data-ev-id="ev_3e0b204fbd">{report.contradictionCount} contradictions</span>
            </div>
          }
        </div>
        
        {/* Footer */}
        <div data-ev-id="ev_8f7d7acbde" className="flex items-center justify-between pt-4 border-t border-r1-border">
          <div data-ev-id="ev_48e73d4b13" className="flex items-center gap-2">
            {report.exportFormats.slice(0, 3).map((format) =>
            <a data-ev-id="ev_c73ec8d740"
            key={format.format}
            href={buildExportUrl(format.filename)}
            className="r1-tag text-[9px] hover:border-r1-cyan/50 hover:text-r1-cyan transition-colors"
            title={`Download ${format.format.toUpperCase()}`}>

                <Download className="w-3 h-3" />
                {format.format.toUpperCase()}
              </a>
            )}
          </div>
          <Link
            to={`/app/reports/${report.id}`}
            className="flex items-center gap-1 text-xs text-r1-muted hover:text-r1-cyan transition-colors">

            Open
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </motion.div>);

}

export default ReportCard;