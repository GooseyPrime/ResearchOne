/**
 * SampleReportView - the public sample report.
 *
 * Shown with the reading page itself (upgrade plan, slice 5 item 8), so a
 * visitor sees what a report looks like: a title, a summary, key findings, the
 * body, the limits and a numbered reference list, with citations that open.
 */
import ReaderView from '@/components/reports/reader/ReaderView';
import { sampleReaderEvidence, sampleReaderReport } from '@/content/sampleReaderReport';

export function SampleReportView() {
  return (
    <div className="min-h-screen pt-20 pb-12 bg-r1-canvas">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <p className="text-sm text-r1-muted">
          A sample report. Select a citation number to see its source, or open the other tabs to see the sources and how a report is researched.
        </p>
        <ReaderView
          report={sampleReaderReport}
          evidence={sampleReaderEvidence}
          method={
            <p className="text-sm text-r1-muted">
              For your own reports this tab shows the plan, the searches that were run and the record of how the report was written. This sample was written by hand to show the page.
            </p>
          }
        />
      </div>
    </div>
  );
}
