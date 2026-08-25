/**
 * SampleReportView - Full sample report layout
 * Shows executive summary, claims, contradictions, challenge notes, revision history
 */

import { motion } from 'framer-motion';
import { Download, AlertTriangle, CheckCircle, FileText, History, ShieldAlert, GitBranch } from 'lucide-react';
import { sampleReportData, evidenceTierMeta } from '@/content/researchoneUiData';

export function SampleReportView() {
  const report = sampleReportData;
  const tierMeta = evidenceTierMeta[report.evidenceTier];

  return (
    <div data-ev-id="ev_c1e57ed051" className="min-h-screen pt-20 pb-12 bg-r1-canvas">
      <div data-ev-id="ev_84e9b13abc" className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8">

          <div data-ev-id="ev_58bda251c8" className="flex items-center gap-3 mb-4">
            <span data-ev-id="ev_fe21c4335a" className="r1-tag r1-tag-amber">
              SAMPLE_REPORT
            </span>
            <span data-ev-id="ev_561db39c0d" className={`r1-tag text-[9px] ${
            tierMeta.color === 'green' ? 'r1-tag-green' :
            tierMeta.color === 'cyan' ? 'r1-tag-cyan' : ''}`
            }>
              {tierMeta.label.toUpperCase()}
            </span>
          </div>
          <h1 data-ev-id="ev_93ac09cabe" className="text-2xl sm:text-3xl font-bold text-r1-heading mb-4">
            {report.title}
          </h1>
          <div data-ev-id="ev_4c3d6841e7" className="flex flex-wrap items-center gap-4 text-sm text-r1-muted">
            <span data-ev-id="ev_8fb89909ae">{report.citationCount} citations</span>
            <span data-ev-id="ev_df71020df9" className="text-r1-amber">{report.contradictionCount} contradictions preserved</span>
            <span data-ev-id="ev_1fcb20da4f">{new Date(report.createdAt).toLocaleDateString()}</span>
          </div>
        </motion.div>

        <div data-ev-id="ev_a3c6b316c3" className="grid lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div data-ev-id="ev_06a0ae6fc9" className="lg:col-span-2 flex flex-col gap-6">
            {/* Executive Summary */}
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="r1-panel p-6">

              <div data-ev-id="ev_14b83da713" className="flex items-center gap-2 mb-4">
                <FileText className="w-4 h-4 text-r1-cyan" />
                <span data-ev-id="ev_835525d84d" className="r1-mono-label text-[10px]">EXECUTIVE_SUMMARY</span>
              </div>
              <div data-ev-id="ev_499046b7bc" className="prose prose-invert prose-sm max-w-none">
                <p data-ev-id="ev_cf4972833a" className="text-r1-text leading-relaxed whitespace-pre-line">
                  {report.executiveSummary}
                </p>
              </div>
            </motion.section>

            {/* Claims Table */}
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="r1-panel">

              <div data-ev-id="ev_e1705f09a5" className="p-4 border-b border-r1-border flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-r1-cyan" />
                <span data-ev-id="ev_14d1586cf6" className="r1-mono-label text-[10px]">CLAIMS_TABLE</span>
              </div>
              <div data-ev-id="ev_aa39fc1dd0" className="divide-y divide-r1-border">
                {report.claims.map((claim, index) => {
                  const claimTier = evidenceTierMeta[claim.evidenceTier];
                  return (
                    <div data-ev-id="ev_23dd6973c8" key={claim.id} className="p-5">
                      <div data-ev-id="ev_eb989da9dc" className="flex items-start gap-4">
                        <span data-ev-id="ev_7036406fd2" className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-r1-panel-lift font-mono text-sm text-r1-muted">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div data-ev-id="ev_56b920e18e" className="flex-1">
                          <div data-ev-id="ev_0b786bd166" className="flex items-center gap-2 mb-2">
                            <span data-ev-id="ev_4a3a0be9a7" className={`r1-tag text-[9px] ${
                            claimTier.color === 'cyan' ? 'r1-tag-cyan' :
                            claimTier.color === 'green' ? 'r1-tag-green' :
                            claimTier.color === 'amber' ? 'r1-tag-amber' :
                            claimTier.color === 'red' ? 'border-r1-skeptic/50 text-r1-skeptic' : ''}`
                            }>
                              {claimTier.label.toUpperCase()}
                            </span>
                            <span data-ev-id="ev_3428499d23" className="r1-mono-label text-[9px] text-r1-dim">
                              {Math.round(claim.confidence * 100)}% CONFIDENCE
                            </span>
                          </div>
                          <p data-ev-id="ev_f4a69f6bb8" className="text-sm text-r1-text leading-relaxed mb-3">
                            {claim.text}
                          </p>
                          <div data-ev-id="ev_dd94fad8d8" className="flex flex-wrap gap-2">
                            {claim.citations.map((cite) =>
                            <span data-ev-id="ev_66fea8ef53" key={cite.id} className="r1-tag text-[9px]">
                                {cite.source}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>);

                })}
              </div>
            </motion.section>

            {/* Contradictions */}
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="r1-panel ring-1 ring-r1-amber/20">

              <div data-ev-id="ev_df0d20a3f9" className="p-4 border-b border-r1-border flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-r1-amber" />
                <span data-ev-id="ev_e90873dfe8" className="r1-mono-label text-[10px]">SOURCE_DISAGREEMENTS</span>
              </div>
              <div data-ev-id="ev_0faf268a0f" className="p-5">
                {report.contradictions.map((contradiction) =>
                <div data-ev-id="ev_9a13158978" key={contradiction.id} className="bg-r1-panel-lift border border-r1-border rounded-lg p-4">
                    <div data-ev-id="ev_eba37d6494" className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-4 h-4 text-r1-amber" />
                      <span data-ev-id="ev_e19490778f" className={`r1-tag text-[9px] r1-tag-amber`}>
                        {contradiction.severity.toUpperCase()}
                      </span>
                    </div>
                    <div data-ev-id="ev_1aaa73c97b" className="grid sm:grid-cols-2 gap-4">
                      <div data-ev-id="ev_5d2aa76a4c">
                        <span data-ev-id="ev_8324107940" className="r1-mono-label text-[9px] text-r1-dim">CLAIM_A</span>
                        <p data-ev-id="ev_1e28af4a94" className="mt-2 text-sm text-r1-text leading-relaxed">{contradiction.claimA}</p>
                      </div>
                      <div data-ev-id="ev_e1b18683e1">
                        <span data-ev-id="ev_2008e60f41" className="r1-mono-label text-[9px] text-r1-dim">CLAIM_B</span>
                        <p data-ev-id="ev_f2776f48db" className="mt-2 text-sm text-r1-text leading-relaxed">{contradiction.claimB}</p>
                      </div>
                    </div>
                    <div data-ev-id="ev_92713f9709" className="mt-3 pt-3 border-t border-r1-border">
                      <span data-ev-id="ev_3f9c9408a8" className="text-xs text-r1-muted">Source: {contradiction.source}</span>
                    </div>
                  </div>
                )}
              </div>
            </motion.section>
          </div>

          {/* Sidebar */}
          <div data-ev-id="ev_3730d5af9d" className="flex flex-col gap-6">
            {/* Export options */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="r1-panel p-5">

              <span data-ev-id="ev_cddaf76d30" className="r1-mono-label text-[10px] text-r1-dim">EXPORT_FORMATS</span>
              <div data-ev-id="ev_f378508fab" className="mt-4 flex flex-col gap-2">
                {['PDF', 'JSON', 'Markdown', 'HTML'].map((format) =>
                <button data-ev-id="ev_3a4c2dc931"
                key={format}
                className="flex items-center justify-between px-4 py-3 bg-r1-panel-lift border border-r1-border rounded-lg hover:border-r1-cyan/50 transition-colors r1-focus-ring">

                    <span data-ev-id="ev_e45d7954d6" className="text-sm text-r1-text">{format}</span>
                    <Download className="w-4 h-4 text-r1-muted" />
                  </button>
                )}
              </div>
            </motion.div>

            {/* Challenge notes */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="r1-panel p-5 ring-1 ring-r1-skeptic/20">

              <div data-ev-id="ev_20174d00fc" className="flex items-center gap-2 mb-4">
                <ShieldAlert className="w-4 h-4 text-r1-skeptic" />
                <span data-ev-id="ev_8ef45dd2b1" className="r1-mono-label text-[10px]">CHALLENGE_NOTES</span>
              </div>
              <ul data-ev-id="ev_463cae128f" className="flex flex-col gap-3">
                {report.challengeNotes.map((note, index) =>
                <li data-ev-id="ev_7cd16fd811" key={index} className="flex items-start gap-2">
                    <span data-ev-id="ev_bf254a447f" className="flex-shrink-0 w-1.5 h-1.5 mt-2 rounded-full bg-r1-skeptic" />
                    <span data-ev-id="ev_8c3fab0cf3" className="text-xs text-r1-muted leading-relaxed">{note}</span>
                  </li>
                )}
              </ul>
            </motion.div>

            {/* Revision History */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="r1-panel p-5">

              <div data-ev-id="ev_b3ceab51b7" className="flex items-center gap-2 mb-4">
                <History className="w-4 h-4 text-r1-cyan" />
                <span data-ev-id="ev_3fd7934c1b" className="r1-mono-label text-[10px]">REVISION_LINEAGE</span>
              </div>
              <div data-ev-id="ev_bcfccf6029" className="flex flex-col gap-3">
                {report.revisionHistory.map((revision, index) =>
                <div data-ev-id="ev_f7dea97c84" key={revision.version} className="flex items-start gap-3">
                    <div data-ev-id="ev_3a8886d570" className={`flex-shrink-0 w-2 h-2 mt-1.5 rounded-full ${
                  index === report.revisionHistory.length - 1 ? 'bg-r1-green' : 'bg-r1-border-strong'}`
                  } />
                    <div data-ev-id="ev_d48e7f64d3">
                      <div data-ev-id="ev_e209be9ba9" className="flex items-center gap-2">
                        <span data-ev-id="ev_1f46dd9243" className="text-xs font-medium text-r1-heading">v{revision.version}</span>
                        <span data-ev-id="ev_5882fa3cef" className="r1-mono-label text-[9px] text-r1-dim">{revision.agent}</span>
                      </div>
                      <p data-ev-id="ev_cab527ce5d" className="text-xs text-r1-muted mt-0.5">{revision.changes}</p>
                      <span data-ev-id="ev_0ed6445db1" className="r1-mono-label text-[8px] text-r1-dim">
                        {new Date(revision.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>);

}

export default SampleReportView;