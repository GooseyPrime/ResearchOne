import { Link } from 'react-router-dom';
import ReportMarkdown from '../reports/ReportMarkdown';
import { ReaderReportBody } from '../reports/reader/ReaderView';
import type { Report } from '../../utils/api';
import { plainReportStatus } from '../../utils/runStatusDisplay';
import { stripReaderLabels } from '../reports/reader/readerModel';

type Props = {
  report: Report | undefined;
  reportLoading: boolean;
  reportError: Error | null;
  fullReportHref: string;
};

/**
 * A dossier's Report tab. The report is shown the one way a report is shown:
 * through the reader view's body, under reader headings, with numbered
 * citations and the reference list. The old layout of this tab — an "output
 * layout" outline, sections under their stored names, and a side panel of notes
 * from the check of the report — was removed on 8 Oct 2026. Challenge material
 * is on the report page's Challenge pass tab, not here.
 */
export default function DossierReportSection({ report, reportLoading, reportError, fullReportHref }: Props) {
  if (reportLoading) {
    return <p className="text-slate-500 text-sm">Loading report…</p>;
  }
  if (reportError) {
    return <p className="text-red-300 text-sm">Could not load the report.</p>;
  }
  if (!report) {
    return <p className="text-slate-500">No report is linked to this dossier yet.</p>;
  }

  const meta = report.metadata as Record<string, unknown> | undefined;
  const plainMd = meta && typeof meta.plain_language_markdown === 'string' ? stripReaderLabels(meta.plain_language_markdown).trim() : '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold text-white leading-snug">{report.title ?? 'Report'}</h3>
        <span className="text-xs text-slate-400">{plainReportStatus(report.status)}</span>
      </div>

      <div className="space-y-5 min-w-0">
        <ReaderReportBody report={report} />
        {plainMd.length > 0 ? (
          <section className="rounded-lg border border-dashed border-slate-700/80 p-3">
            <h4 className="text-slate-200 text-sm font-medium mb-2">Plain-language summary</h4>
            <div className="prose prose-invert prose-sm max-w-none text-slate-300">
              <ReportMarkdown>{plainMd}</ReportMarkdown>
            </div>
          </section>
        ) : null}
      </div>

      <Link to={fullReportHref} className="inline-flex items-center gap-2 text-accent hover:underline text-sm">
        Open the full report
      </Link>
    </div>
  );
}
