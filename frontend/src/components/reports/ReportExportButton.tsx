import { useEffect, useState } from 'react';
import { exportErrorMessage } from '@/utils/exportErrorMessage';
import { Download, AlertCircle, Loader2 } from 'lucide-react';
import api from '../../utils/api';
import { customerOption, customerOptionHelp, findCustomerOption } from '../../content/customerOptions';

/**
 * Report export button — opens the format/style selector modal.
 *
 * Behavior:
 *   - Probes the export engine on mount via
 *     `GET /api/reports/exports/engine-status` (Rule 28 I-6).
 *   - Renders disabled with a tooltip when pandoc is unavailable
 *     (Rule 28 I-6).
 *   - Modal handles sync vs async path; small markdown exports stream
 *     inline, DOCX/PDF go async with a polling indicator.
 */

export type ExportFormat = 'docx' | 'pdf' | 'md' | 'html';
export type ExportStyle =
  | 'numeric'
  | 'mla' | 'apa'
  | 'chicago-author-date' | 'chicago-note'
  | 'ieee' | 'harvard';

const EXPORT_FORMATS: readonly ExportFormat[] = ['docx', 'pdf', 'md', 'html'];
const EXPORT_STYLES: readonly ExportStyle[] = ['numeric', 'mla', 'apa', 'chicago-author-date', 'chicago-note', 'ieee', 'harvard'];

/** File types and citation styles, named from the registry of customer-facing names. */
const FORMAT_LABELS = Object.fromEntries(
  EXPORT_FORMATS.map((format) => [format, customerOption('export_format', format).name])
) as Record<ExportFormat, string>;

const STYLE_LABELS = Object.fromEntries(
  EXPORT_STYLES.map((style) => [style, customerOption('citation_style', style).name])
) as Record<ExportStyle, string>;

/** What the chosen option does, with its example, from the registry of customer-facing names. */
function OptionHelpLine({ group, id }: { group: 'export_format' | 'citation_style'; id: string }) {
  const words = findCustomerOption(group, id);
  return words ? <p className="mt-1 text-[11px] leading-snug text-slate-500">{customerOptionHelp(words)}</p> : null;
}

function coerceExportStyle(raw: string | null | undefined): ExportStyle | null {
  if (raw == null || raw === '') return null;
  return Object.prototype.hasOwnProperty.call(STYLE_LABELS, raw) ? (raw as ExportStyle) : null;
}

export interface ReportExportButtonProps {
  reportId: string;
  /**
   * The style the export dialog opens on: the style the report's reference list
   * was saved in when the report records one, else `research_runs.citation_style`
   * for the report's source run.
   */
  runCitationStyle?: string | null;
}

export default function ReportExportButton({ reportId, runCitationStyle }: ReportExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('docx');
  const [style, setStyle] = useState<ExportStyle>('apa');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<'idle' | 'rendering' | 'polling' | 'done'>('idle');
  const [pandocUnavailable, setPandocUnavailable] = useState(false);
  /** `loading` until the first engine-status probe finishes. */
  const [engineProbe, setEngineProbe] = useState<'loading' | 'ok' | 'down' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ available?: boolean; version?: string | null; detail?: string }>(
          '/reports/exports/engine-status'
        );
        if (cancelled) return;
        const available = res.data?.available === true;
        if (!available) {
          setEngineProbe('down');
          setPandocUnavailable(true);
          setError(
            res.data?.detail ??
              'Pandoc is not installed on this server. Contact your administrator.'
          );
        } else {
          setEngineProbe('ok');
        }
      } catch {
        if (cancelled) return;
        // Do not hard-block exports if the probe route is temporarily broken.
        setEngineProbe('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const s = coerceExportStyle(runCitationStyle);
    if (s) setStyle(s);
  }, [runCitationStyle]);

  async function startExport() {
    setSubmitting(true);
    setError(null);
    setProgress('rendering');

    // Sync path for small lightweight formats — streams directly.
    const sync = format === 'md' || format === 'html';

    try {
      if (sync) {
        const res = await api.post(`/reports/${reportId}/export`, {
          format, style, sync: true,
        }, { responseType: 'blob' });

        // The response COULD be the pandoc-not-installed envelope
        // (JSON), or it could be the file blob. Disambiguate via
        // content-type.
        const blob = res.data as Blob;
        if (blob.type.startsWith('application/json')) {
          const text = await blob.text();
          const json = JSON.parse(text);
          if (json.available === false) {
            setPandocUnavailable(true);
            setError(json.detail ?? 'Pandoc is not installed on this server.');
            return;
          }
          setError(json.detail ?? json.error ?? 'Export failed');
          return;
        }

        triggerBlobDownload(blob, `report-${reportId.slice(0, 8)}-${style}.${format}`);
        setProgress('done');
        setOpen(false);
      } else {
        // Async path.
        const enqueue = await api.post(`/reports/${reportId}/export`, {
          format, style, sync: false,
        });
        if (enqueue.data?.available === false) {
          setPandocUnavailable(true);
          setError(enqueue.data.detail ?? 'Pandoc is not installed on this server.');
          return;
        }
        const exportId = enqueue.data.exportId as string;
        setProgress('polling');
        await pollUntilComplete(exportId);
        setProgress('done');
        setOpen(false);
      }
    } catch (err) {
      setError(await exportErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function pollUntilComplete(exportId: string): Promise<void> {
    // Simple linear backoff. Max ~2 minutes total.
    const maxAttempts = 60;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await api.get(`/reports/exports/${exportId}`);
      const status = poll.data?.status as string;
      if (status === 'completed') {
        if (poll.data.output_url) {
          window.open(poll.data.output_url, '_blank', 'noopener,noreferrer');
        }
        return;
      }
      if (status === 'failed' || status === 'timed_out') {
        throw new Error(poll.data.error_detail ?? `Export ${status}`);
      }
    }
    throw new Error('Export timed out polling');
  }

  const exportBlocked = engineProbe === 'loading' || pandocUnavailable;
  const exportTitle =
    engineProbe === 'loading'
      ? 'Checking whether the server export engine is available…'
      : pandocUnavailable
        ? (error ?? 'Academic export is not available on this server.')
        : engineProbe === 'error'
          ? 'Could not verify the export engine; you can still try — the check may have failed.'
          : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const s = coerceExportStyle(runCitationStyle);
          if (s) setStyle(s);
          setOpen(true);
        }}
        className="btn-secondary inline-flex items-center gap-2"
        aria-label="Export this report"
        disabled={exportBlocked}
        title={exportTitle}
      >
        <Download className="w-4 h-4" />
        Export
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => !submitting && setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-surface-300 border border-indigo-900/30 rounded-xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white mb-4">Export report</h2>

            {pandocUnavailable && (
              <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-none" />
                <div>
                  <div className="font-medium">Export not available</div>
                  <div className="text-amber-300/80 mt-1">
                    {error ?? 'The server has not been configured for academic export. Contact your administrator.'}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Format</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ExportFormat)}
                  disabled={submitting}
                  className="input w-full"
                >
                  {Object.entries(FORMAT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <OptionHelpLine group="export_format" id={format} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Citation style</label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value as ExportStyle)}
                  disabled={submitting}
                  className="input w-full"
                >
                  {Object.entries(STYLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <OptionHelpLine group="citation_style" id={style} />
              </div>
            </div>

            {error && !pandocUnavailable && (
              <div className="mt-3 text-sm text-red-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-none" />
                <span>{error}</span>
              </div>
            )}

            {progress === 'polling' && (
              <div className="mt-3 text-sm text-slate-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Rendering on the server — this can take up to a minute for PDF.
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={startExport}
                disabled={submitting || pandocUnavailable}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Exporting…
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Export
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
