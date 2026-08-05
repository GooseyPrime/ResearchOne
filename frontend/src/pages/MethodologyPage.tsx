/**
 * MethodologyPage - Pipeline methodology explanation
 */

import { R1Shell } from '@/components/r1-shell/R1Shell';
import { MethodologyPipeline } from '@/components/r1-vault/MethodologyPipeline';
import { Link } from 'react-router-dom';
import { ChevronRight, FileText } from 'lucide-react';
import {
  HOW_YOUR_REPORT_IS_MADE_HEADING,
  HOW_YOUR_REPORT_IS_MADE_STEPS,
} from '@/content/howYourReportIsMade';
import {
  HOW_RESEARCHONE_THINKS_SECTIONS,
  OUTLIER_BRIDGING_MARKETING,
  POSTURE_FAMILIES,
} from '@/content/howResearchOneThinks';

export default function MethodologyPage() {
  return (
    <R1Shell variant="public">
      {/* Hero */}
      <section data-ev-id="ev_2cd3949cbb" className="pt-24 pb-12 bg-r1-canvas-deep border-b border-r1-border">
        <div data-ev-id="ev_157c45e3a4" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <span data-ev-id="ev_02a1786d3d" className="r1-tag r1-tag-cyan mb-4 inline-flex">
            METHODOLOGY
          </span>
          <h1 data-ev-id="ev_e6675ad580" className="text-3xl sm:text-4xl lg:text-5xl font-bold text-r1-heading leading-tight text-balance">
            How ResearchOne works
          </h1>
          <p data-ev-id="ev_aa5ad26f36" className="mt-4 text-xl text-r1-muted leading-relaxed">
            A transparent look at shared safeguards and adaptive methods across different research goals.
          </p>
        </div>
      </section>

      {/* Plain-language overview */}
      <section className="py-16 bg-r1-canvas border-b border-r1-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-r1-heading mb-6">{HOW_YOUR_REPORT_IS_MADE_HEADING}</h2>
          <ol className="max-w-3xl flex flex-col gap-3 list-decimal list-inside text-[15px] text-r1-muted leading-relaxed">
            {HOW_YOUR_REPORT_IS_MADE_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </section>
      
      {/* Pipeline visualization */}
      <MethodologyPipeline />
      
      {/* Additional methodology content */}
      <section data-ev-id="ev_f7aee2320e" className="py-20 lg:py-32 bg-r1-canvas-deep">
        <div data-ev-id="ev_ba5a82429a" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12">
            {/* Skeptic check */}
            <div data-ev-id="ev_1e40fe866e" className="r1-panel p-6 lg:p-8 ring-1 ring-r1-skeptic/20">
              <span data-ev-id="ev_4117025d57" className="r1-tag mb-4 inline-flex border-r1-skeptic/50 text-r1-skeptic">
                CHALLENGE_REVIEW
              </span>
              <h3 data-ev-id="ev_d800821cdc" className="text-xl font-bold text-r1-heading mb-4">
                Why we argue against our own draft
              </h3>
              <p data-ev-id="ev_22a137e75d" className="text-[15px] text-r1-muted leading-relaxed mb-4 text-pretty">
                For verification-heavy or high-stakes work, ResearchOne can run independent challenge checks before
                finalizing a report. These checks challenge important conclusions, look for weak
                corroboration, and surface alternative interpretations.
              </p>
              <ul data-ev-id="ev_301776280f" className="flex flex-col gap-2">
                {[
                'Challenges claim confidence levels',
                'Identifies unsupported assertions',
                'Flags potential confirmation bias',
                'Surfaces contradictory evidence'].map((item, i) =>
                <li data-ev-id="ev_0dc4f9f082" key={i} className="flex items-start gap-2 text-sm text-r1-muted">
                    <span data-ev-id="ev_367358ce9f" className="flex-shrink-0 w-1.5 h-1.5 mt-2 rounded-full bg-r1-skeptic" />
                    {item}
                  </li>
                )}
              </ul>
            </div>
            
            {/* Contradiction preservation */}
            <div data-ev-id="ev_587712de5f" className="r1-panel p-6 lg:p-8 ring-1 ring-r1-amber/20">
              <span data-ev-id="ev_5dffdd583e" className="r1-tag mb-4 inline-flex r1-tag-amber">
                SOURCE_DISAGREEMENTS
              </span>
              <h3 data-ev-id="ev_fabd1bd0c7" className="text-xl font-bold text-r1-heading mb-4">
                Truth is messy. Our reports reflect that.
              </h3>
              <p data-ev-id="ev_7f41472e59" className="text-[15px] text-r1-muted leading-relaxed mb-4 text-pretty">
                Unlike systems that silently resolve conflicts, ResearchOne preserves
                source disagreements in a dedicated review layer. When sources disagree, we show you
                both perspectives with full context.
              </p>
              <ul data-ev-id="ev_fb2d7422a3" className="flex flex-col gap-2">
                {[
                'Source disagreements are surfaced, not hidden',
                'Each conflict includes source attribution',
                'Severity levels help prioritize review',
                'Resolution notes when conflicts are resolved'].map((item, i) =>
                <li data-ev-id="ev_4739b33387" key={i} className="flex items-start gap-2 text-sm text-r1-muted">
                    <span data-ev-id="ev_ac7058838a" className="flex-shrink-0 w-1.5 h-1.5 mt-2 rounded-full bg-r1-amber" />
                    {item}
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </section>
      
      {/* How ResearchOne thinks */}
      <section className="py-16 bg-r1-canvas border-b border-r1-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-r1-heading mb-3">How ResearchOne thinks</h2>
          <p className="max-w-3xl text-[15px] text-r1-muted leading-relaxed mb-8">{OUTLIER_BRIDGING_MARKETING}</p>

          <div className="grid sm:grid-cols-2 gap-6 mb-10">
            {HOW_RESEARCHONE_THINKS_SECTIONS.map((section) => (
              <div key={section.id} className="r1-panel p-5 space-y-2">
                <h3 className="text-base font-semibold text-r1-heading">{section.heading}</h3>
                <p className="text-sm text-r1-muted leading-relaxed">{section.body}</p>
              </div>
            ))}
          </div>

          {/* Posture family cards */}
          <h3 className="text-lg font-semibold text-r1-heading mb-4">Research posture by path</h3>
          <div className="grid sm:grid-cols-3 gap-4">
            {POSTURE_FAMILIES.map((family) => (
              <div key={family.id} className="r1-panel p-5 space-y-2">
                <span
                  className={`inline-block rounded border px-2 py-0.5 text-[11px] uppercase tracking-wide ${family.badgeClass}`}
                >
                  {family.label}
                </span>
                <p className="text-sm text-r1-muted leading-relaxed">{family.shortDescription}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section data-ev-id="ev_e8c1910adb" className="py-20 bg-r1-canvas border-t border-r1-border">
        <div data-ev-id="ev_87d67152b4" className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 data-ev-id="ev_4b5e59f775" className="text-2xl font-bold text-r1-heading mb-4">
            See the methodology in action
          </h2>
          <p data-ev-id="ev_c131e13bf2" style={{ display: 'block', width: '100%', maxWidth: '600px', margin: '0 auto 32px auto' }} className="text-r1-muted text-center">
            Explore a complete research report to see how planning, source reading, analysis, and verification
            combine into a cited dossier.
          </p>
          <div data-ev-id="ev_c741136543" className="flex flex-wrap justify-center gap-4">
            <Link
              to="/sample-report"
              className="inline-flex items-center gap-2 px-6 py-3 text-base font-semibold bg-r1-cyan text-r1-canvas rounded hover:bg-r1-cyan/90 transition-all duration-200 r1-focus-ring">

              <FileText className="w-4 h-4" />
              View Sample Report
            </Link>
            <Link
              to="/sign-up"
              className="inline-flex items-center gap-2 px-6 py-3 text-base font-medium text-r1-text bg-r1-panel border border-r1-border rounded hover:bg-r1-panel-lift transition-all duration-200 r1-focus-ring">

              Start Your Research
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </R1Shell>);

}